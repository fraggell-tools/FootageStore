/**
 * Shared constants for the /api/health endpoint and the worker that feeds it.
 *
 * The worker writes heartbeat + sync signals into Redis; /api/health reads them
 * so the Fraggell Monitor can detect the failure modes a homepage 200-check
 * cannot see:
 *   - a wedged queue consumer (worker "Up" but not draining jobs), and
 *   - Drive-sync insert failures (clips silently failing to be created).
 *
 * Both of those caused real incidents on 2026-06-05 that went unnoticed because
 * the only monitoring was a public homepage ping (see CLAUDE.md Incident History).
 */
export const QUEUE_NAME = "clip-processing";

export const HEALTH_KEYS = {
  /** ms timestamp the worker process last wrote a heartbeat (every 30s) */
  workerHeartbeat: "footagestore:health:worker:heartbeatAt",
  /** ms timestamp the worker last started/finished a job (consumer liveness) */
  workerLastJob: "footagestore:health:worker:lastJobAt",
  /** ms timestamp the Drive sync last completed a full run */
  syncLastRunAt: "footagestore:health:sync:lastRunAt",
  /** number of clip inserts that failed in the most recent sync run (resets to 0 on a clean run) */
  syncFailuresLastRun: "footagestore:health:sync:insertFailuresLastRun",
  /** last clip-insert error message, for the alert detail */
  syncLastError: "footagestore:health:sync:lastInsertError",
} as const;

/** How often the worker writes its heartbeat. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 30 * 1000;

/** Heartbeat older than this ⇒ worker process is down. */
export const WORKER_HEARTBEAT_STALE_MS = 3 * 60 * 1000;

/**
 * Jobs are waiting but the worker hasn't touched one in this long ⇒ the consumer
 * is stalled. Set well above the slowest single clip (large Drive downloads can
 * take many minutes) so a busy worker is never mistaken for a stalled one; the
 * incident this guards against sat idle for ~20 hours.
 */
export const QUEUE_STALL_MS = 30 * 60 * 1000;

/** No completed Drive sync in this long ⇒ the sync loop has died (it runs every 3 min). */
export const SYNC_STALE_MS = 15 * 60 * 1000;
