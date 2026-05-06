import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { ensureDir } from "../../src/lib/storage";

const anthropic = new Anthropic();

const FRAME_COUNT = 12;

const SHOT_TYPES = [
  "Close-Up",
  "Extreme Close-Up",
  "Medium",
  "Wide",
  "Full Body",
  "Over the Shoulder",
  "POV",
  "Top Down",
  "Low Angle",
  "High Angle",
  "Tracking",
  "Other",
] as const;

interface SceneAnalysis {
  name: string;
  description: string;
  shotType: string;
  tags: string[];
  isTalkingToCamera: boolean;
}

export async function generateClipName(
  inputPath: string,
  duration: number,
  clipId: string,
  transcript?: string
): Promise<SceneAnalysis> {
  const tmpDir = path.join("/tmp", `clip-analysis-${clipId}`);
  await ensureDir(tmpDir);

  // Extract 12 frames evenly spaced through the clip
  const timepoints = Array.from({ length: FRAME_COUNT }, (_, i) => {
    const pct = (i + 0.5) / FRAME_COUNT;
    return pct * duration;
  });

  const framePaths: string[] = [];

  try {
    for (let i = 0; i < timepoints.length; i++) {
      const framePath = path.join(tmpDir, `frame_${i.toString().padStart(2, "0")}.jpg`);
      framePaths.push(framePath);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(timepoints[i])
          .frames(1)
          .outputOptions(["-vf", "scale=720:-1", "-q:v", "3"])
          .output(framePath)
          .on("end", () => resolve())
          .on("error", (err) =>
            reject(new Error(`Frame extraction failed: ${err.message}`))
          )
          .run();
      });
    }

    // Read frames as base64
    const imageContents: Anthropic.ImageBlockParam[] = [];
    for (const fp of framePaths) {
      const data = await fs.readFile(fp);
      imageContents.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: data.toString("base64"),
        },
      });
    }

    const trimmedTranscript = transcript?.trim() ?? "";
    const transcriptBlock = trimmedTranscript
      ? `\n\nAUDIO TRANSCRIPT (Whisper, audio track of the same clip):\n"""\n${trimmedTranscript.slice(0, 4000)}\n"""\nUse this alongside the visuals — reflect what's said in the description and use it as one signal for the IS_TALKING_TO_CAMERA judgement below.`
      : "";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            ...imageContents,
            {
              type: "text",
              text: `These are ${FRAME_COUNT} frames extracted in sequence from a video clip (evenly spaced from start to end). Analyze the full sequence as if you're watching the video.${transcriptBlock}

Respond in EXACTLY this format:

TITLE: [3-8 word descriptive title]
SHOT_TYPE: [exactly one of: ${SHOT_TYPES.join(", ")}]
IS_TALKING_TO_CAMERA: [yes or no — see strict criteria below]
TAGS: [comma-separated tags from the categories below]
DESCRIPTION: [Detailed paragraph describing the scene]

For IS_TALKING_TO_CAMERA, answer "yes" ONLY when ALL of these are true:
- A person's face is directly addressing the camera (front-facing, looking at lens)
- Lip movement is visible across multiple frames consistent with the transcript
- The speech is sustained delivery, not a brief snippet or background chatter
- Voiceover, off-screen narration, overheard speech, or audio from someone whose face isn't shown → "no"
- Music with vocals → "no"
- A person facing camera but not actually speaking (e.g. silent reaction, posed shot) → "no"
This is a strict gate — when in doubt, answer "no".

For SHOT_TYPE, classify the PRIMARY camera framing. Pick one:
- Close-Up: Head/face or product fills most of the frame
- Extreme Close-Up: Very tight on details (eyes, texture, small product parts)
- Medium: Waist-up framing of a person, or mid-distance product shot
- Wide: Full scene visible, environment prominent, subject smaller in frame
- Full Body: Entire person visible head to toe
- Over the Shoulder: Shot from behind/beside one person looking at another or at product
- POV: First-person perspective, as if viewer is doing the action
- Top Down: Camera looking straight down from above (flat lay, overhead)
- Low Angle: Camera shooting upward at the subject
- High Angle: Camera shooting downward at the subject
- Tracking: Camera physically moves to follow the subject
- Other: Doesn't fit any category above

For TAGS, select ALL that apply from these categories:

Subject: Man, Woman, Couple, Group, Hands Only, No People
Action: Talking Head, Holding Product, Applying Product, Unboxing, Demonstrating, Eating/Drinking, Exercising, Walking, Sitting, Dancing
Content Style: UGC, Professional, Testimonial, Product Demo, Lifestyle, A-Roll, B-Roll, Tutorial, Before & After, ASMR, Transition (use A-Roll only when IS_TALKING_TO_CAMERA is yes; use B-Roll otherwise; never both)
Setting: Studio, Outdoor, Kitchen, Bathroom, Bedroom, Living Room, Gym, Office, Car, Restaurant
Mood: Bright, Moody, Natural Light, Studio Lit, Warm, Cool, Dark

Only include tags that clearly apply. Use the exact tag names above.

For the DESCRIPTION, include:
- What subjects/people are doing (actions, movements, gestures)
- Objects, products, or items visible and how they're used
- Camera movement (pan, zoom, static, tracking, close-up, wide shot)
- Scene transitions or changes throughout the clip
- Setting/environment (studio, outdoor, kitchen, bathroom, etc.)
- Lighting and mood (natural, studio, warm, bright, moody)
- Any text, branding, or logos visible
- Style of footage (UGC, professional, testimonial, product demo, lifestyle, b-roll)

Write naturally — this description will be used for search, so use the kind of words someone would type when looking for this footage.`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const text = textBlock?.text?.trim() ?? "";

    // Parse the response
    const titleMatch = text.match(/TITLE:\s*(.+)/i);
    const shotTypeMatch = text.match(/SHOT_TYPE:\s*(.+)/i);
    const talkingMatch = text.match(/IS_TALKING_TO_CAMERA:\s*(.+)/i);
    const tagsMatch = text.match(/TAGS:\s*(.+)/i);
    const descMatch = text.match(/DESCRIPTION:\s*([\s\S]+)/i);

    const name = titleMatch?.[1]?.trim() ?? "Untitled Clip";
    const rawShotType = shotTypeMatch?.[1]?.trim() ?? "Other";
    const shotType = SHOT_TYPES.find(
      (t) => t.toLowerCase() === rawShotType.toLowerCase()
    ) ?? "Other";
    const isTalkingToCamera = /^\s*yes\b/i.test(talkingMatch?.[1] ?? "");
    const tags = tagsMatch?.[1]
      ?.split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0) ?? [];
    const description = descMatch?.[1]?.trim() ?? text;

    return { name, description, shotType, tags, isTalkingToCamera };
  } finally {
    // Clean up temp files
    for (const fp of framePaths) {
      await fs.unlink(fp).catch(() => {});
    }
    await fs.rmdir(tmpDir).catch(() => {});
  }
}
