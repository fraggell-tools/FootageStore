/**
 * Backfill script: transcribes audio + re-runs AI scene analysis on existing clips,
 * applying the new combined talking-to-camera gate and A-Roll/B-Roll tagging.
 *
 * Dry-run by default. Use --save to persist to DB.
 *
 *   --limit N     Max clips to process (default 5)
 *   --client SLUG Only clips for this client slug
 *   --save        Write transcript, has_speech, tags, name, description, shot_type
 *   --all         Process every video clip without has_speech set yet (use with --save)
 *
 * Examples:
 *   npx tsx worker/transcribeBackfill.ts                          # dry-run, 5 random
 *   npx tsx worker/transcribeBackfill.ts --limit 20 --save        # save 20 to DB
 *   npx tsx worker/transcribeBackfill.ts --all --save             # full backfill
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull, sql } from "drizzle-orm";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { clips, clients } from "../src/lib/db/schema";
import { transcribeAudio } from "./processors/transcribeAudio";
import { generateClipName } from "./processors/generateClipName";
import { downloadFileFromDrive } from "../src/lib/gdrive";
import { ensureDir } from "../src/lib/storage";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

interface Args {
  limit: number;
  clientSlug: string | null;
  save: boolean;
  all: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { limit: 5, clientSlug: null, save: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = parseInt(argv[++i], 10);
    else if (a === "--client") out.clientSlug = argv[++i];
    else if (a === "--save") out.save = true;
    else if (a === "--all") out.all = true;
  }
  return out;
}

function applyRollTag(tags: string[], isTalkingToCamera: boolean): string[] {
  const filtered = tags.filter(
    (t) => t.toLowerCase() !== "a-roll" && t.toLowerCase() !== "b-roll"
  );
  filtered.push(isTalkingToCamera ? "A-Roll" : "B-Roll");
  return filtered;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set"); process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set"); process.exit(1);
  }

  const conditions = [
    eq(clips.status, "ready"),
    isNull(clips.hasSpeech),
    sql`${clips.duration} IS NOT NULL AND ${clips.duration} > 0`,
    sql`${clips.mimeType} LIKE 'video/%'`,
  ];

  if (args.clientSlug) {
    const [client] = await db
      .select()
      .from(clients)
      .where(eq(clients.slug, args.clientSlug))
      .limit(1);
    if (!client) {
      console.error(`No client with slug ${args.clientSlug}`);
      process.exit(1);
    }
    conditions.push(eq(clips.clientId, client.id));
  }

  const baseQuery = db
    .select({
      id: clips.id,
      filename: clips.originalFilename,
      driveFileId: clips.driveFileId,
      duration: clips.duration,
    })
    .from(clips)
    .where(and(...conditions));

  const targets = args.all
    ? await baseQuery
    : await baseQuery.orderBy(sql`random()`).limit(args.limit);

  console.log(
    `Mode: ${args.save ? "SAVE" : "DRY-RUN"} - ${targets.length} clip(s) - ${
      args.clientSlug ?? "all clients"
    }`
  );
  console.log("=".repeat(78));

  let totalDuration = 0;
  let totalWhisperCost = 0;
  let aRoll = 0;
  let bRoll = 0;
  let failed = 0;
  const tmpRoot = "/tmp/transcribe-backfill";
  await ensureDir(tmpRoot);

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    if (!c.duration || !c.driveFileId) {
      console.log(`[${i + 1}/${targets.length}] ${c.filename} - skip (no duration / driveId)`);
      continue;
    }

    const ext = c.filename.match(/\.[^.]+$/)?.[0] ?? ".mp4";
    const localPath = path.join(tmpRoot, `${c.id}${ext}`);

    try {
      console.log(`\n[${i + 1}/${targets.length}] ${c.filename} (${c.duration!.toFixed(1)}s)`);
      const stream = await downloadFileFromDrive(c.driveFileId);
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(localPath);
        stream.pipe(ws);
        ws.on("finish", () => resolve());
        ws.on("error", reject);
      });

      const t = await transcribeAudio(localPath, c.duration!, c.id);
      const wps = c.duration ? (t.wordCount / c.duration!) : 0;
      const a = await generateClipName(localPath, c.duration!, c.id, t.transcript || undefined);

      const combined = t.hasSpeech && a.isTalkingToCamera;
      const finalTags = applyRollTag(a.tags, combined);
      const finalTranscript = combined ? t.transcript : null;

      totalDuration += c.duration!;
      totalWhisperCost += t.costUsd;
      if (combined) aRoll++; else bRoll++;

      console.log(`    audio: ${t.hasSpeech ? "PASS" : "fail"} (${t.wordCount}w, ${wps.toFixed(2)} w/s)   AI: ${a.isTalkingToCamera ? "PASS" : "fail"}   ->  ${combined ? "A-Roll" : "B-Roll"}`);
      console.log(`    title: ${a.name}`);
      console.log(`    tags:  ${finalTags.join(", ")}`);
      if (finalTranscript) {
        const preview = finalTranscript.replace(/\s+/g, " ").slice(0, 140);
        console.log(`    "${preview}${finalTranscript.length > 140 ? "..." : ""}"`);
      }

      if (args.save) {
        await db
          .update(clips)
          .set({
            name: a.name,
            description: a.description,
            shotType: a.shotType,
            tags: finalTags,
            transcript: finalTranscript,
            hasSpeech: combined,
            updatedAt: new Date(),
          })
          .where(eq(clips.id, c.id));
      }
    } catch (err) {
      failed++;
      console.error(`    FAIL: ${(err as Error).message}`);
    } finally {
      await fsPromises.unlink(localPath).catch(() => {});
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log(
    `Done. A-Roll: ${aRoll}   B-Roll: ${bRoll}   Failed: ${failed}   ` +
      `Whisper: $${totalWhisperCost.toFixed(4)} on ${(totalDuration / 60).toFixed(1)} min`
  );
  if (!args.save) {
    console.log("\n(DRY-RUN) Nothing was written to the DB. Re-run with --save to persist.");
  }

  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
