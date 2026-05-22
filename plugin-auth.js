// plugin-auth.js - Fraggell Premiere Plugin Auth Server
// Runs alongside the Next.js app, handles JWT creation for the plugin
// Usage: node /app/plugin-auth.js

const http = require('http');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'db',
  port: 5432,
  user: process.env.POSTGRES_USER || 'footagestore',
  password: process.env.POSTGRES_PASSWORD || 'footagestore',
  database: process.env.POSTGRES_DB || 'footagestore'
});

const PLUGIN_KEY = process.env.PLUGIN_API_KEY || 'fraggell-premiere-plugin-2026';
const SECRET = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || '';
const PORT = 3709;

async function getEncode() {
  try {
    const mod = await import('@auth/core/jwt');
    return mod.encode;
  } catch(e) {
    // fallback: use jose directly with same algorithm as Auth.js v5
    const jose = await import('jose');
    const { hkdf } = await import('node:crypto');
    const { promisify } = require('util');
    const hkdfAsync = promisify(hkdf);

    return async function encode({ token, secret: sec, salt }) {
      const keyMaterial = await hkdfAsync('sha256', sec, salt, `Auth.js Generated Encryption Key (${salt})`, 64);
      const key = await jose.importRawKey({ type: 'secret', key: Buffer.from(keyMaterial) }, { name: 'A256CBC-HS512' }).catch(() => {
        // Use createSecretKey
        return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-CBC', length: 256 }, false, ['encrypt','decrypt']);
      });
      const jwtKey = jose.createSecretKey(Buffer.from(keyMaterial));
      return await new jose.EncryptJWT(token)
        .setProtectedHeader({ alg: 'dir', enc: 'A256CBC-HS512' })
        .setIssuedAt()
        .setExpirationTime('30d')
        .encrypt(jwtKey);
    };
  }
}

async function createSessionToken(user) {
  const encode = await getEncode();
  return await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      id: user.id,
    },
    secret: SECRET,
    salt: '__Secure-authjs.session-token',
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || req.url !== '/api/auth/plugin') {
    res.writeHead(404); res.end('{"error":"Not found"}'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { email, password, pluginKey } = JSON.parse(body);

      if (pluginKey !== PLUGIN_KEY) {
        res.writeHead(401); res.end('{"error":"Unauthorized"}'); return;
      }
      if (!email || !password) {
        res.writeHead(400); res.end('{"error":"Email and password required"}'); return;
      }

      const result = await pool.query(
        'SELECT id, email, name, role, password_hash FROM users WHERE email = $1 LIMIT 1',
        [email]
      );

      if (!result.rows.length || !bcrypt.compareSync(password, result.rows[0].password_hash)) {
        res.writeHead(401); res.end('{"error":"Invalid email or password"}'); return;
      }

      const user = result.rows[0];
      const sessionToken = await createSessionToken(user);

      res.writeHead(200);
      res.end(JSON.stringify({
        sessionToken,
        user: { id: user.id, email: user.email, name: user.name, role: user.role }
      }));

    } catch (err) {
      console.error('[plugin-auth] error:', err.message);
      res.writeHead(500); res.end('{"error":"Server error: ' + err.message.replace(/"/g, "'") + '"}');
    }
  });
});

server.listen(PORT, () => console.log('[plugin-auth] Listening on port ' + PORT));