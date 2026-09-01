import http from 'node:http';
import { Readable } from 'node:stream';

const PORT = Number(process.env.PORT || 8080);
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8 * 1024 * 1024);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20_000);
const RAILWAY_ORIGIN = normalizeOrigin(process.env.RAILWAY_ORIGIN);
const EXTRA_ALLOWED_ORIGINS = new Set(
  String(process.env.GATEWAY_ALLOWED_ORIGINS || '')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => normalizeOrigin(value).origin)
);

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'user-agent',
  'x-pivnik-version',
  'x-pivnik-platform',
  'x-pivnik-explicit-consent',
  'x-staff-session'
];
const EXPOSED_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'last-modified'
];
const CORS_REQUEST_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Pivnik-Version',
  'X-Pivnik-Platform',
  'X-Pivnik-Explicit-Consent',
  'X-Staff-Session'
].join(', ');
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function normalizeOrigin(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) throw new Error('RAILWAY_ORIGIN is required.');
  const url = new URL(text);
  if (url.protocol !== 'https:') throw new Error('RAILWAY_ORIGIN must use HTTPS.');
  return url;
}

function isVkHostingOrigin(value) {
  if (!value) return false;
  let url;
  try { url = new URL(value); }
  catch { return false; }
  if (url.protocol !== 'https:') return false;
  if (EXTRA_ALLOWED_ORIGINS.has(url.origin)) return true;

  const host = url.hostname.toLowerCase();
  if (host === 'vk.com' || host === 'vk.ru' || host === 'm.vk.com' || host === 'm.vk.ru') return true;
  return host.endsWith('.pages.vk-apps.com') || host.endsWith('.pages.vk-apps.ru');
}

function setCors(req, res) {
  const origin = String(req.headers.origin || '').trim();
  if (!isVkHostingOrigin(origin)) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'Origin');
  res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('access-control-allow-headers', CORS_REQUEST_HEADERS);
  res.setHeader('access-control-max-age', '600');
}

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  if (!WRITE_METHODS.has(String(req.method || '').toUpperCase())) return undefined;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function buildUpstreamHeaders(req) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }

  // Railway rejects browser cross-site mutations by design. The gateway first
  // validates the real browser Origin above, then turns the second hop into a
  // trusted server-to-server request to the Railway origin.
  headers.set('origin', RAILWAY_ORIGIN.origin);
  headers.set('x-pivnik-gateway', 'vk-native-hosting');
  const remote = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (remote) headers.set('x-forwarded-for', remote);
  return headers;
}

async function proxyApi(req, res, url) {
  const method = String(req.method || 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return json(res, 405, { ok: false, error: 'Method not allowed.' });

  const origin = String(req.headers.origin || '').trim();
  if (!isVkHostingOrigin(origin)) {
    return json(res, 403, { ok: false, error: 'VK Hosting Origin is required.' });
  }
  setCors(req, res);

  if (method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (WRITE_METHODS.has(method) && String(req.headers['x-pivnik-platform'] || '').toLowerCase() !== 'vk') {
    return json(res, 403, { ok: false, error: 'VK platform header is required.' });
  }

  const target = new URL(url.pathname + url.search, RAILWAY_ORIGIN);
  const body = await readBody(req);
  const upstream = await fetch(target, {
    method,
    headers: buildUpstreamHeaders(req),
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
  });

  res.statusCode = upstream.status;
  for (const name of EXPOSED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('cache-control', upstream.headers.get('cache-control') || 'no-store');

  if (method === 'HEAD' || !upstream.body) return res.end();
  Readable.fromWeb(upstream.body).pipe(res);
}

async function upstreamReady(res) {
  try {
    const response = await fetch(new URL('/api/platform-health', RAILWAY_ORIGIN), {
      headers: { accept: 'application/json', 'user-agent': 'pivnik-vk-gateway-readiness/1.0' },
      signal: AbortSignal.timeout(8_000)
    });
    const data = await response.json().catch(() => ({}));
    return json(res, response.ok && data?.ok === true && data?.vk === true ? 200 : 503, {
      ok: response.ok && data?.ok === true && data?.vk === true,
      gateway: 'vk-native-hosting',
      upstreamStatus: response.status,
      upstream: {
        ok: data?.ok === true,
        vk: data?.vk === true,
        environment: data?.environment || null,
        releaseCommit: data?.releaseCommit || null,
        databaseFingerprint: data?.databaseFingerprint || null
      }
    });
  } catch (error) {
    return json(res, 503, { ok: false, gateway: 'vk-native-hosting', error: String(error?.message || error) });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://gateway.local');
    if (url.pathname === '/healthz') {
      return json(res, 200, { ok: true, gateway: 'vk-native-hosting' });
    }
    if (url.pathname === '/readyz') return upstreamReady(res);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return json(res, 404, { ok: false, error: 'Only /api/* is exposed.' });
    }
    return await proxyApi(req, res, url);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 502);
    return json(res, statusCode, {
      ok: false,
      error: statusCode >= 500 ? 'Upstream gateway error.' : String(error?.message || error)
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    ok: true,
    service: 'pivnik-vk-api-gateway',
    port: PORT,
    upstream: RAILWAY_ORIGIN.origin
  }));
});
