const http = require('http');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const PORT = 3701;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const REPO_DIR = process.env.REPO_DIR || '/repo';
const COMPOSE_PROJECT = process.env.COMPOSE_PROJECT || 'app';

function verifySignature(payload, signature) {
  if (!WEBHOOK_SECRET) return true;
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  hmac.update(payload);
  const expected = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
}

function deploy() {
  console.log(`[${new Date().toISOString()}] Starting deployment...`);

  try {
    // Reset any local changes (e.g. docker-compose.yml modified by docker) before pulling
    console.log('Resetting local changes...');
    execSync('git checkout -- .', { cwd: REPO_DIR, encoding: 'utf8', timeout: 10000 });

    // Pull latest code
    console.log('Pulling latest code...');
    const pullOutput = execSync('git pull origin main', { cwd: REPO_DIR, encoding: 'utf8', timeout: 60000 });
    console.log(pullOutput);

    // Rebuild and restart app + worker (not db, redis, or this webhook service)
    console.log('Rebuilding containers...');
    const buildOutput = execSync(
      `docker compose -p ${COMPOSE_PROJECT} build app worker`,
      { cwd: REPO_DIR, encoding: 'utf8', timeout: 600000 }
    );
    console.log(buildOutput);

    console.log('Restarting containers...');
    const upOutput = execSync(
      `docker compose -p ${COMPOSE_PROJECT} up -d app worker`,
      { cwd: REPO_DIR, encoding: 'utf8', timeout: 120000 }
    );
    console.log(upOutput);

    console.log(`[${new Date().toISOString()}] Deployment complete!`);
    return { success: true, message: 'Deployment complete' };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Deployment failed:`, err.message);
    return { success: false, message: err.message };
  }
}

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'footagestore-deploy-webhook' }));
    return;
  }

  // Status page
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('FootageStore Deploy Webhook - Ready');
    return;
  }

  // Webhook endpoint
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Verify GitHub signature
      const signature = req.headers['x-hub-signature-256'];
      if (WEBHOOK_SECRET && !verifySignature(body, signature)) {
        console.log(`[${new Date().toISOString()}] Invalid signature - rejected`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }

      // Only deploy on push to main
      try {
        const payload = JSON.parse(body);
        if (payload.ref && payload.ref !== 'refs/heads/main') {
          console.log(`[${new Date().toISOString()}] Ignoring push to ${payload.ref}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Ignored - not main branch' }));
          return;
        }
      } catch (e) {
        // If we can't parse, still deploy (might be a manual trigger)
      }

      // Respond immediately, deploy async
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Deployment started' }));

      // Run deploy in background
      setImmediate(() => deploy());
    });
    return;
  }

  // Manual deploy trigger
  if (req.method === 'POST' && req.url === '/deploy') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Manual deployment started' }));
    setImmediate(() => deploy());
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Deploy webhook listening on port ${PORT}`);
  console.log(`Repo directory: ${REPO_DIR}`);
  console.log(`Compose project: ${COMPOSE_PROJECT}`);
  console.log(`Webhook secret: ${WEBHOOK_SECRET ? 'configured' : 'NOT SET (accepting all requests)'}`);
});
