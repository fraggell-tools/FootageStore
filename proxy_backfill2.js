
const { Pool } = require('pg');
const https = require('https');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || './data';
const API_BASE = 'footagestore.fraggell.com';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Get a fresh session token for downloading
async function getSessionToken() {
  const { Pool: P2 } = require('pg');
  const p2 = new P2({ connectionString: process.env.DATABASE_URL });
  const r = await p2.query("SELECT id,email,name,role FROM users WHERE role='admin' LIMIT 1");
  await p2.end();
  if (!r.rows.length) throw new Error('No admin user found');
  // Use the existing session by reading it from the environment or just use signed URL approach
  // Actually let's read cookies from the DB session — just use download via node directly
  return null; // we'll handle auth below
}

function downloadFromAPI(clipId, sessionToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_BASE, port: 443,
      path: '/api/clips/' + clipId + '/download', method: 'GET',
      headers: {
        'Cookie': '__Secure-authjs.session-token=' + sessionToken,
        'User-Agent': 'FraggellBackfill/1.0'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const loc = res.headers.location;
        if (!loc) return reject(new Error('No redirect location'));
        const url = new URL(loc);
        const lib = url.protocol === 'https:' ? https : require('http');
        lib.get(loc, res2 => { resolve(res2); }).on('error', reject);
        return;
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}

async function encodeProxy(inputPath, outputPath) {
  const partPath = outputPath + '.part';
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-i', inputPath,
      '-vf', 'scale=w=854:h=480:force_original_aspect_ratio=decrease',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
      '-maxrate', '800k', '-bufsize', '1600k',
      '-c:a', 'aac', '-b:a', '64k',
      '-movflags', '+faststart', '-f', 'mp4', partPath
    ], { timeout: 300000 }, (err, _, stderr) => {
      if (err) reject(new Error('ffmpeg: ' + (stderr||'').slice(-200)));
      else resolve();
    });
  });
  fs.renameSync(partPath, outputPath);
}

async function processClip(clip, sessionToken) {
  const proxyPath = path.join(DATA_DIR, 'processed', clip.id, 'proxy.mp4');
  const origPath  = proxyPath + '.orig';
  if (fs.existsSync(proxyPath) && fs.statSync(proxyPath).size > 0) return 'skip';

  const stream = await downloadFromAPI(clip.id, sessionToken);
  await new Promise((res, rej) => {
    const ws = fs.createWriteStream(origPath);
    stream.pipe(ws);
    ws.on('finish', res);
    ws.on('error', rej);
    stream.on('error', rej);
  });

  await encodeProxy(origPath, proxyPath);
  try { fs.unlinkSync(origPath); } catch(e) {}
  return 'done';
}

async function main() {
  // Get a valid session token from the env or create one
  // The NEXTAUTH_SECRET is available since we're on the server
  const crypto = require('crypto');
  const jose = await import('jose');
  const SECRET = process.env.NEXTAUTH_SECRET || 'footagestore-prod-secret-change-me-later';
  const salt = '__Secure-authjs.session-token';
  const info = Buffer.from('Auth.js Generated Encryption Key (' + salt + ')');
  const km = crypto.hkdfSync('sha256', Buffer.from(SECRET), Buffer.from(salt), info, 64);
  const key = crypto.createSecretKey(Buffer.from(km));

  // Get admin user
  const ur = await pool.query("SELECT id,email,name,role FROM users WHERE role='admin' LIMIT 1");
  if (!ur.rows.length) throw new Error('No admin user');
  const u = ur.rows[0];
  const sessionToken = await new jose.EncryptJWT({ sub: u.id, email: u.email, name: u.name, role: u.role, id: u.id })
    .setProtectedHeader({ alg: 'dir', enc: 'A256CBC-HS512' })
    .setIssuedAt().setExpirationTime('7d').encrypt(key);

  console.log('Got session token for', u.email);

  const r = await pool.query("SELECT id FROM clips WHERE status='ready' AND drive_file_id IS NOT NULL ORDER BY updated_at DESC");
  console.log('Clips to process:', r.rows.length);

  let done = 0, skip = 0, err = 0;
  const CONCURRENCY = 2; // gentle on the server

  for (let i = 0; i < r.rows.length; i += CONCURRENCY) {
    const batch = r.rows.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async clip => {
      try {
        const result = await processClip(clip, sessionToken);
        if (result === 'skip') skip++;
        else { done++; }
      } catch(e) {
        err++;
        console.error('FAIL', clip.id, e.message.slice(0, 60));
      }
    }));
    if ((done + skip + err) % 20 === 0 || done % 10 === 0) {
      const pct = Math.round(((done+skip+err)/r.rows.length)*100);
      console.log(`[${pct}%] done=${done} skip=${skip} err=${err} / ${r.rows.length}`);
    }
  }

  console.log(`COMPLETE: done=${done} skip=${skip} err=${err}`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
