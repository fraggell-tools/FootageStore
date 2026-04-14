import ffmpeg from "fluent-ffmpeg";
import path from "path";
import { ensureDir } from "../../src/lib/storage";

export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  duration: number
): Promise<void> {
  await ensureDir(path.dirname(outputPath));

  const seekTime = duration / 2;

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .seekInput(seekTime)
      .frames(1)
      .outputOptions(["-vf", "scale=1280:-1", "-q:v", "2"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) =>
        reject(new Error(`Thumbnail generation failed: ${err.message}`))
      )
      .run();
  });
}
