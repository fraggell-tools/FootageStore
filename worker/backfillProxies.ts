/**
 * Backfill 480p preview proxies for existing clips.
 *
 * For every ready video clip that doesn't yet have a proxy, download the source
 * from Drive, encode a 480p MP4, upload it to R2, and record proxyStatus. This
 * does NOT touch AI analysis, tags, or the original — proxy only.
 *
 * Run with:  docker exec app-worker-1 npx tsx worker/backfillProxies.ts
 * Tunables:  BACKFILL_LIMIT (default all), BACKFILL_CONCURRENCY (default 2)
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, ne, isNull, or } from "drizzle-orm";
import { clips } from "../src/lib/db/schema";
import { downloadFileFromDrive } from "../src/lib/gdrive";
import { getProcessedDir, ensureDir } from "../src/lib/storage";
import { generateProxy } from "./processors/generateProxy";
import { uploadToR2, r2Enabled } from "../src/lib/r2";
import fs from "fs";
import fsPromises from "fs/promises";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const CONCURRENCY = parseInt(process.env.BACKFILL_CONCURRENCY || "2", 10);
const LIMIT = process.env.BACKFILL_LIMIT ? parseInt(process.env.BACKFILL_LIMIT, 10) : undefined;

const isImage = (name: string) => /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(name);

async function processOne(clip: {
  id: string;
  driveFileId: string | null;
  originalFilename: string;
}): Promise<"done" | "skip" | "fail"> {
  if (isImage(clip.originalFilename)) return "skip";
  if (!clip.driveFileId) return "skip";

  const processedDir = getProcessedDir(clip.id);
  await ensureDir(processedDir);
  const ext = clip.originalFilename.match(/\.[^.]+$/)?.[0] || ".mp4";
  const srcPath = `${processedDir}/backfill_src${ext}`;
  const proxyPath = `${processedDir}/backfill_proxy_480.mp4`;

  try {
    const stream = await downloadFileFromDrive(clip.driveFileId);
    const ws = fs.createWriteStream(srcPath);
    await new Promise<void>((resolve, reject) => {
      stream.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
    });

    const size = await generateProxy(srcPath, proxyPath);
    const key = `proxy/${clip.id}.mp4`;
    await uploadToR2(key, await fsPromises.readFile(proxyPath), "video/mp4");

    await db
      .update(clips)
      .set({ proxyStatus: "done", proxyR2Key: key, proxyError: null, updatedAt: new Date() })
      .where(eq(clips.id, clip.id));
    console.log(`  ✓ ${clip.id} (${(size / 1e6).toFixed(1)} MB)`);
    return "done";
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    await db
      .update(clips)
      .set({ proxyStatus: "failed", proxyError: msg, updatedAt: new Date() })
      .where(eq(clips.id, clip.id));
    console.warn(`  ✗ ${clip.id}: ${msg}`);
    return "fail";
  } finally {
    await fsPromises.unlink(srcPath).catch(() => {});
    await fsPromises.unlink(proxyPath).catch(() => {});
  }
}

async function main() {
  if (!r2Enabled) {
    console.error("R2 is not configured (R2_ACCOUNT_ID / keys). Aborting.");
    await pool.end();
    process.exit(1);
  }

  // Ready clips whose proxy is missing or previously failed.
  const rows = await db
    .select({
      id: clips.id,
      driveFileId: clips.driveFileId,
      originalFilename: clips.originalFilename,
    })
    .from(clips)
    .where(
      and(
        eq(clips.status, "ready"),
        or(isNull(clips.proxyStatus), eq(clips.proxyStatus, "none"), ne(clips.proxyStatus, "done"))
      )
    )
    .limit(LIMIT ?? 1_000_000);

  console.log(`Backfilling proxies for ${rows.length} clips (concurrency ${CONCURRENCY})`);

  let done = 0, skip = 0, fail = 0, i = 0;
  async function worker() {
    while (i < rows.length) {
      const clip = rows[i++];
      const r = await processOne(clip);
      if (r === "done") done++;
      else if (r === "skip") skip++;
      else fail++;
      if ((done + skip + fail) % 50 === 0) {
        console.log(`  … ${done + skip + fail}/${rows.length} (done ${done}, skip ${skip}, fail ${fail})`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`Done. done=${done}, skipped=${skip}, failed=${fail}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
