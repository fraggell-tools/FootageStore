import { execFile } from "child_process";
import fs from "fs";

// Single 480p faststart MP4 proxy for fast previews (panel + web). Ported from
// fraggell-review's ffmpeg-proxy.ts, trimmed to the one rung we need — no HLS
// ladder, no 720p. NVENC (GPU) is used when available and falls back to libx264
// (CPU) automatically, so this works with or without a GPU on the worker host.

const ENCODE_THREADS = parseInt(process.env.ENCODE_THREADS || "8", 10);
const ENCODE_NICE = parseInt(process.env.ENCODE_NICE || "10", 10);
const NVENC_ENABLED = process.env.NVENC_ENABLED !== "false";

// Prepend `nice` args + a thread cap so a single encode can't starve the host.
function ffmpegArgv(args: string[]): string[] {
  return ["-n", String(ENCODE_NICE), "ffmpeg", "-threads", String(ENCODE_THREADS), ...args];
}

let nvencProbe: Promise<boolean> | null = null;
function nvencAvailable(): Promise<boolean> {
  if (!NVENC_ENABLED) return Promise.resolve(false);
  if (!nvencProbe) {
    nvencProbe = new Promise<boolean>((resolve) => {
      execFile(
        "ffmpeg",
        [
          "-hide_banner", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
          "-c:v", "h264_nvenc", "-g", "12", "-bf", "0", "-f", "null", "-",
        ],
        { timeout: 20_000 },
        (err) => {
          if (err) console.warn("[generateProxy] NVENC unavailable, using libx264 (CPU)");
          else console.log("[generateProxy] NVENC available — encoding on the GPU");
          resolve(!err);
        }
      );
    });
  }
  return nvencProbe;
}

type Encoder = "nvenc" | "x264";

function videoEncoderArgs(encoder: Encoder, bitrate: string, maxrate: string, bufsize: string): string[] {
  if (encoder === "nvenc") {
    return [
      "-c:v", "h264_nvenc",
      "-preset", "p5",
      "-rc", "vbr",
      "-b:v", bitrate,
      "-maxrate", maxrate,
      "-bufsize", bufsize,
      "-bf", "0",
      "-g", "48",
      "-pix_fmt", "yuv420p",
    ];
  }
  return [
    "-c:v", "libx264",
    "-preset", "fast",
    "-x264-params", `threads=${ENCODE_THREADS}`,
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
  ];
}

async function runEncodeWithFallback(
  buildArgs: (encoder: Encoder) => string[],
  timeout: number,
  onRetry: () => void
): Promise<void> {
  const useNvenc = await nvencAvailable();
  const chain: Encoder[] = useNvenc ? ["nvenc", "x264"] : ["x264"];
  let lastErr: Error | null = null;
  for (let i = 0; i < chain.length; i++) {
    const enc = chain[i];
    if (i > 0) onRetry();
    try {
      await new Promise<void>((resolve, reject) => {
        execFile("nice", buildArgs(enc), { timeout }, (err, _stdout, stderr) => {
          if (err) {
            reject(new Error(`ffmpeg failed (480p, ${enc}): ${stderr?.slice(-400) || err.message}`));
            return;
          }
          resolve();
        });
      });
      return;
    } catch (e) {
      lastErr = e as Error;
      if (enc === "nvenc") console.warn("[generateProxy] NVENC failed, retrying on libx264");
    }
  }
  throw lastErr ?? new Error("ffmpeg failed (480p)");
}

/**
 * Encode a 480p faststart MP4 proxy from `sourcePath` to `outputPath`.
 * Returns the output size in bytes. Throws on failure (caller treats
 * proxy generation as non-fatal so the clip still finishes processing).
 */
export async function generateProxy(sourcePath: string, outputPath: string): Promise<number> {
  if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size === 0) {
    throw new Error("Source file missing or empty");
  }

  const tmpPath = outputPath + ".tmp.mp4";
  const bitrate = "1200k";
  const maxrate = "1400k";
  const bufsize = "2400k";

  try {
    await runEncodeWithFallback(
      (encoder) =>
        ffmpegArgv([
          "-i", sourcePath,
          "-vf", "scale=-2:480",
          ...videoEncoderArgs(encoder, bitrate, maxrate, bufsize),
          "-c:a", "aac",
          "-b:a", "96k",
          "-ac", "2",
          "-movflags", "+faststart",
          "-y",
          tmpPath,
        ]),
      300_000,
      () => {
        try { fs.unlinkSync(tmpPath); } catch { /* */ }
      }
    );
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* */ }
    throw err;
  }

  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
    try { fs.unlinkSync(tmpPath); } catch { /* */ }
    throw new Error("ffmpeg produced empty output (480p)");
  }
  fs.renameSync(tmpPath, outputPath);
  return fs.statSync(outputPath).size;
}
