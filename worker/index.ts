import { Worker } from "bullmq";
import { createRedisConnection } from "../src/lib/redis";
import { processClip } from "./processors/processClip";
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
    console.log(`[Worker] Job ${job.id} started — clipId: ${job.data.clipId}`);
    await processClip(job.data);
    recordJobActivity();
    console.log(`[Worker] Job ${job.id} completed — clipId: ${job.data.clipId}`);
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
