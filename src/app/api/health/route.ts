import { NextResponse } from "next/server";
import IORedis from "ioredis";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  QUEUE_NAME,
  HEALTH_KEYS,
  WORKER_HEARTBEAT_STALE_MS,
  QUEUE_STALL_MS,
  SYNC_STALE_MS,
} from "@/lib/health";

// Must run on Node (pg + ioredis), and must never be cached — the Fraggell
// Monitor polls this every 2 minutes and alerts Slack on any non-200.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * GET /api/health — deep health check.
 *
 * Public (excluded from auth in middleware) so the monitor can reach it. Returns
 * 200 when everything is healthy, 503 with per-check detail otherwise.
 */
export async function GET() {
  const checks: Record<string, Check> = {};
  const fail = (k: string, detail: string) => {
    checks[k] = { ok: false, detail };
  };
  const pass = (k: string, detail: string) => {
    checks[k] = { ok: true, detail };
  };

  // 1. Database reachable
  try {
    await withTimeout(db.execute(sql`select 1`), 2500, "database");
    pass("database", "reachable");
  } catch (err) {
    fail("database", (err as Error).message);
  }

  // 2. Redis + queue + worker + sync (all read from the shared Redis the worker writes to)
  const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2500,
    retryStrategy: () => null,
  });
  redis.on("error", () => {}); // surface failures via command rejection, not unhandled events

  try {
    await withTimeout(redis.ping(), 2500, "redis");
    pass("redis", "reachable");

    const now = Date.now();
    const [waitLen, activeLen, heartbeat, lastJob, syncRunAt, syncFailures, syncErr] =
      await withTimeout(
        Promise.all([
          redis.llen(`bull:${QUEUE_NAME}:wait`),
          redis.llen(`bull:${QUEUE_NAME}:active`),
          redis.get(HEALTH_KEYS.workerHeartbeat),
          redis.get(HEALTH_KEYS.workerLastJob),
          redis.get(HEALTH_KEYS.syncLastRunAt),
          redis.get(HEALTH_KEYS.syncFailuresLastRun),
          redis.get(HEALTH_KEYS.syncLastError),
        ]),
        3000,
        "redis-read"
      );

    const waiting = Number(waitLen ?? 0);
    const active = Number(activeLen ?? 0);

    // Worker process alive? (heartbeat written every 30s)
    const hbAge = heartbeat ? now - Number(heartbeat) : null;
    if (hbAge === null) {
      fail("worker", "no heartbeat recorded — worker process not running?");
    } else if (hbAge > WORKER_HEARTBEAT_STALE_MS) {
      fail("worker", `worker heartbeat stale (${Math.round(hbAge / 1000)}s ago)`);
    } else {
      pass("worker", `alive, heartbeat ${Math.round(hbAge / 1000)}s ago`);
    }

    // Queue draining? (the consumer stall that went unnoticed for ~20h)
    const jobAge = lastJob ? now - Number(lastJob) : null;
    if (waiting > 0 && (jobAge === null || jobAge > QUEUE_STALL_MS)) {
      const ago = jobAge === null ? "never" : `${Math.round(jobAge / 60000)}m ago`;
      fail(
        "queue",
        `${waiting} job(s) waiting but worker last processed one ${ago} — not draining`
      );
    } else {
      pass("queue", `${waiting} waiting, ${active} active`);
    }

    // Drive sync creating clips OK? (the file_size overflow that silently dropped clips)
    const failures = Number(syncFailures ?? 0);
    const syncAge = syncRunAt ? now - Number(syncRunAt) : null;
    if (failures > 0) {
      fail(
        "sync",
        `last Drive sync failed to create ${failures} clip(s): ${syncErr || "unknown error"}`
      );
    } else if (syncAge === null) {
      pass("sync", "no sync run recorded yet");
    } else if (syncAge > SYNC_STALE_MS) {
      fail("sync", `no Drive sync completed in ${Math.round(syncAge / 60000)}m (runs every 3m)`);
    } else {
      pass("sync", `last run ${Math.round(syncAge / 60000)}m ago, no insert failures`);
    }
  } catch (err) {
    fail("redis", (err as Error).message);
  } finally {
    redis.disconnect();
  }

  const healthy = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    { status: healthy ? "ok" : "unhealthy", checks, checkedAt: new Date().toISOString() },
    { status: healthy ? 200 : 503 }
  );
}
