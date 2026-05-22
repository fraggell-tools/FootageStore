
const { Pool } = require('pg');
const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || './data';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const queue = new Queue('clip-processing', { connection: redis });
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const r = await pool.query("SELECT id FROM clips WHERE status='ready' AND drive_file_id IS NOT NULL");
  console.log('Total ready clips:', r.rows.length);
  
  let queued = 0, skip = 0;
  // Process in batches of 50 to avoid overwhelming the queue
  const BATCH = 50;
  
  for (const clip of r.rows) {
    const proxyPath = path.join(DATA_DIR, 'processed', clip.id, 'proxy.mp4');
    if (fs.existsSync(proxyPath)) { skip++; continue; }
    
    await queue.add('process-clip', { clipId: clip.id }, {
      jobId: 'proxy-backfill-' + clip.id,
      removeOnComplete: true,
      removeOnFail: 100,
      // Lower priority than new clips
      priority: 10,
    });
    queued++;
    
    if (queued % BATCH === 0) {
      console.log(`Queued ${queued} so far...`);
    }
  }
  
  console.log(`Done. Queued: ${queued}, Already had proxy: ${skip}`);
  await pool.end();
  await redis.quit();
}

run().catch(e => { console.error(e.message); process.exit(1); });
