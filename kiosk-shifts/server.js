import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { createKioskShiftGateway, KIOSK_SHIFT_PATH_PREFIX } from './gateway.js';

// Standalone shifts service: its own process and database, no bonus-app code or data.
//   DATABASE_URL          Postgres of this service only (migration 012 applied there)
//   KIOSK_SESSION_SECRET  random string >= 32 chars (hashes phone keys)
//   PIVNIK_KIOSK_SHIFTS=true plus the KIOSK_SHIFT_* / OPENAI_* / GOOGLE_* variables from gateway.js
const rateLimitBuckets = new Map();

function requestAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.socket?.remoteAddress || 'unknown');
}

function enforceRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const recent = (rateLimitBuckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    throw Object.assign(new Error('Слишком много запросов. Повторите позже.'), { statusCode: 429 });
  }
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  if (rateLimitBuckets.size > 5000) {
    for (const [bucketKey, timestamps] of rateLimitBuckets) {
      if (!timestamps.some((timestamp) => now - timestamp < windowMs)) rateLimitBuckets.delete(bucketKey);
    }
  }
}

export function createKioskShiftServer({ pool, sessionSecret, env = process.env, startWorker = true }) {
  const gateway = createKioskShiftGateway({ pool, sessionSecret, env, enforceRateLimit, requestAddress, startWorker });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('ok');
    }
    if (url.pathname.startsWith(KIOSK_SHIFT_PATH_PREFIX)) return gateway.handler(req, res, url);
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  });
  return { server, gateway };
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || '');
  const secret = String(process.env.KIOSK_SESSION_SECRET || '');
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  if (secret.length < 32) throw new Error('KIOSK_SESSION_SECRET (>= 32 chars) is required.');
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('railway.internal') ? false : { rejectUnauthorized: false }
  });
  const { server } = createKioskShiftServer({ pool, sessionSecret: crypto.createHash('sha256').update(secret).digest('hex') });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`pivnik kiosk shifts listening on ${port}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
