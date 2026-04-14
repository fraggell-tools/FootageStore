import { Worker } from "bullmq";
import { createRedisConnection } from "../src/lib/redis";
import { processClip } from "./processors/processClip";

console.log("[Worker] Starting clip-processing worker...");

const worker = new Worker(
  "clip-processing",
  async (job) => {
    console.log(`[Worker] Job ${job.id} started — clipId: ${job.data.clipId}`);
    await processClip(job.data);
    console.log(`[Worker] Job ${job.id} completed — clipId: ${job.data.clipId}`);
  },
  {
    connection: createRedisConnection(),
    concurrency: 2,
  }
);

worker.on("failed", (job, err) => {
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
