
const { Pool } = require('pg');
const { downloadFileFromDrive } = require('./src/lib/gdrive');
const { getProcessedDir } = require('./src/lib/storage');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsP = require('fs/promises');

const DATA_DIR = process.env.DATA_DIR || './data';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function genProxy(clip) {
  const proxyPath = path.join(DATA_DIR, 'processed', clip.id, 'proxy.mp4');
  const origPath  = proxyPath.replace('.mp4', '.orig');
  const partPath  = proxyPath + '.part';
  if (fs.existsSync(proxyPath)) return 'skip';

  // Download from Drive
  const stream = await downloadFileFromDrive(clip.drive_file_id);
  await new Promise((res, rej) => {
    const ws = fs.createWriteStream(origPath);
    stream.pipe(ws);
    ws.on('finish', res);
    ws.on('error', rej);
  });

  // Encode proxy
  await new Promise((res, rej) => {
    execFile('ffmpeg', ['-y', '-i', origPath,
      '-vf', 'scale=w=854:h=480:force_original_aspect_ratio=decrease',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-maxrate', '800k', '-bufsize', '1600k',
      '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+faststart', '-f', 'mp4', partPath
    ], (err, _, stderr) => {
      if (err) rej(new Error('ffmpeg: ' + stderr.slice(-200)));
      else res();
    });
  });

  fs.renameSync(partPath, proxyPath);
  try { fs.unlinkSync(origPath); } catch(e) {}
  return 'done';
}

async function run() {
  const r = await pool.query(
    "SELECT id, drive_file_id FROM clips WHERE status='ready' AND drive_file_id IS NOT NULL ORDER BY updated_at DESC"
  );
  console.log('Clips to process:', r.rows.length);
  let done=0, skip=0, err=0;
  const CONCURRENCY = 3;
  
  // Process in parallel batches of CONCURRENCY
  for (let i = 0; i < r.rows.length; i += CONCURRENCY) {
    const batch = r.rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async clip => {
      try {
        const result = await genProxy(clip);
        if (result === 'skip') skip++;
        else done++;
      } catch(e) {
        console.error('FAIL', clip.id, e.message.slice(0, 80));
        err++;
      }
    }));
    if ((done + skip + err) % 30 === 0) {
      console.log(`Progress: done=${done} skip=${skip} err=${err}`);
    }
  }
  console.log(`Complete: done=${done} skip=${skip} err=${err}`);
  await pool.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
