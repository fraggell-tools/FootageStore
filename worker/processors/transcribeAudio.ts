import ffmpeg from "fluent-ffmpeg";
import path from "path";
import fs from "fs/promises";
import { execFileSync } from "child_process";
import { ensureDir } from "../../src/lib/storage";

function hasAudioStream(inputPath: string): boolean {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        inputPath,
      ],
      { encoding: "utf8" }
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export interface TranscriptResult {
  transcript: string;
  hasSpeech: boolean;
  wordCount: number;
  durationUsed: number;
  costUsd: number;
}

// Whisper API: $0.006/min. Audio gate is intentionally strict — sustained speech (~1.5 words/sec)
// is typical of talking-to-camera; lower rates are usually overheard chatter or voice in b-roll.
// The visual half of the gate happens in generateClipName.ts.
const WHISPER_PRICE_PER_MINUTE = 0.006;
const SPEECH_WPS_THRESHOLD = 1.5;

export async function transcribeAudio(
  inputPath: string,
  duration: number,
  clipId: string
): Promise<TranscriptResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const tmpDir = path.join("/tmp", `clip-transcribe-${clipId}`);
  await ensureDir(tmpDir);
  const audioPath = path.join(tmpDir, "audio.mp3");

  // Skip clips with no audio track — saves an API call and avoids ffmpeg errors.
  if (!hasAudioStream(inputPath)) {
    return {
      transcript: "",
      hasSpeech: false,
      wordCount: 0,
      durationUsed: duration,
      costUsd: 0,
    };
  }

  try {
    // 16kHz mono mp3 @ 32kbps — sized for Whisper's 25MB cap (~109 min) at quality it can read.
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16000)
        .audioBitrate("32k")
        .format("mp3")
        .output(audioPath)
        .on("end", () => resolve())
        .on("error", (err) =>
          reject(new Error(`Audio extraction failed: ${err.message}`))
        )
        .run();
    });

    const stat = await fs.stat(audioPath).catch(() => null);
    if (!stat || stat.size < 200) {
      // No audio track or essentially empty — skip API call
      return {
        transcript: "",
        hasSpeech: false,
        wordCount: 0,
        durationUsed: duration,
        costUsd: 0,
      };
    }

    const audioBuffer = await fs.readFile(audioPath);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" }),
      "audio.mp3"
    );
    formData.append("model", "whisper-1");
    formData.append("response_format", "text");
    formData.append("language", "en");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Whisper API ${res.status}: ${body.slice(0, 300)}`);
    }

    const rawTranscript = (await res.text()).trim();
    const wordCount = rawTranscript ? rawTranscript.split(/\s+/).length : 0;
    const wordsPerSec = duration > 0 ? wordCount / duration : 0;
    const hasSpeech = wordsPerSec > SPEECH_WPS_THRESHOLD;
    // Below the threshold the transcript is usually a Whisper hallucination on music/silence.
    // Drop it so we don't pollute the search index with garbage.
    const transcript = hasSpeech ? rawTranscript : "";
    const costUsd = (duration / 60) * WHISPER_PRICE_PER_MINUTE;

    return { transcript, hasSpeech, wordCount, durationUsed: duration, costUsd };
  } finally {
    await fs.unlink(audioPath).catch(() => {});
    await fs.rmdir(tmpDir).catch(() => {});
  }
}
