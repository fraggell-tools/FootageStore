const { Pool } = require('pg');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const DATA_DIR = process.env.DATA_DIR || './data';

async function run() {
  const r = await pool.query("SELECT id, drive_file_id FROM clips WHERE status='ready' AND drive_file_id IS NOT NULL");
  console.log('Total ready clips:', r.rows.length);
  let done=0, skip=0, err=0;
  for (const clip of r.rows) {
    const proxyPath = path.join(DATA_DIR, 'processed', clip.id, 'proxy.mp4');
    if (fs.existsSync(proxyPath)) { skip++; continue; }
    // Check original temp is gone — worker will re-download via queue
    // Just log what needs doing; actual generation happens via worker queue
    console.log('Needs proxy:', clip.id);
    done++;
  }
  console.log(`Needs proxy: ${done}, Already has proxy: ${skip}, Errors: ${err}`);
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
