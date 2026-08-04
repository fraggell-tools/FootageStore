import { Worker } from "bullmq";
import { createRedisConnection } from "../src/lib/redis";
import { processClip } from "./processors/processClip";
import { importDrive } from "./processors/importDrive";
import { importDropbox } from "./processors/importDropbox";
import { HEALTH_KEYS, WORKER_HEARTBEAT_INTERVAL_MS } from "../src/lib/health";

console.log("[Worker] Starting clip-processing worker...");

// Health signals for /api/health (read by the Fraggell Monitor):
//   heartbeat = the process is alive; lastJob = the queue consumer is actually
//   processing. A wedged consumer keeps the heartbeat fresh but stops touching
//   jobs — which is exactly how the 2026-06-05 stall hid behind "container Up".
const health = createRedisConnection();
const recordJobActivity = () => {
  health.set(HEALTH_KEYS.workerLastJob, Date.now().toString()).catch(() => {});
};
const beat = () => {
  health.set(HEALTH_KEYS.workerHeartbeat, Date.now().toString()).catch(() => {});
};
beat();
setInterval(beat, WORKER_HEARTBEAT_INTERVAL_MS);

const worker = new Worker(
  "clip-processing",
  async (job) => {
    recordJobActivity();
    if (job.name === "import-drive") {
      console.log(`[Worker] Job ${job.id} started — import: ${job.data.importId}`);
      await importDrive(job.data);
      console.log(`[Worker] Job ${job.id} completed — import: ${job.data.importId}`);
    } else if (job.name === "import-dropbox") {
      console.log(`[Worker] Job ${job.id} started — dropbox import: ${job.data.importId}`);
      await importDropbox(job.data);
      console.log(`[Worker] Job ${job.id} completed — dropbox import: ${job.data.importId}`);
    } else {
      console.log(`[Worker] Job ${job.id} started — clipId: ${job.data.clipId}`);
      await processClip(job.data);
      console.log(`[Worker] Job ${job.id} completed — clipId: ${job.data.clipId}`);
    }
    recordJobActivity();
  },
  {
    connection: createRedisConnection(),
    concurrency: 2,
  }
);

worker.on("failed", (job, err) => {
  recordJobActivity();
  console.error(
    `[Worker] Job ${job?.id} failed — clipId: ${job?.data?.clipId}`,
    err.message
  );
});

worker.on("error", (err) => {
  console.error("[Worker] Worker error:", err.message);
});

console.log("[Worker] Listening for jobs on queue: clip-processing");

// Start Google Drive sync (runs every 3 minutes)
import("./syncDrive").catch((err) => {
  console.error("[Worker] Failed to start Drive sync:", err.message);
});

// Self-healing proxy backfill: on every worker startup, resume generating 480p
// proxies for any existing clips that don't have one yet. This makes the long
// backfill survive worker restarts (it just picks up where it left off) instead
// of dying silently. No-op once every ready clip has a proxy. `onlyNone` skips
// previously-failed clips so broken sources aren't retried forever. Disable with
// PROXY_BACKFILL_ON_STARTUP=false. Runs 30s after boot so the queue + sync settle.
if (process.env.PROXY_BACKFILL_ON_STARTUP !== "false") {
  setTimeout(() => {
    import("./backfillProxies")
      .then(({ runProxyBackfill }) =>
        runProxyBackfill({ onlyNone: true }).catch((err) =>
          console.error("[Worker] proxy backfill failed:", err.message)
        )
      )
      .catch((err) => console.error("[Worker] failed to load proxy backfill:", err.message));
  }, 30_000);
}
