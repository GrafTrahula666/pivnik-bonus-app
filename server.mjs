import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { pathToFileURL } from 'node:url';

const PRODUCTION_ORIGIN = 'https://pivnik-bonus-app-production-df60.up.railway.app';
const ROUTES = new Map([
  ['/api/health', 'GET'],
  ['/api/device/pos/qr/resolve', 'POST'],
  ['/api/device/pos/receipts/bind', 'POST'],
]);
const MAX_REQUEST = 16 * 1024;
const MAX_RESPONSE = 64 * 1024;

class EntryError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function json(res, status, error) {
  if (!res.destroyed) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' });
    res.end(JSON.stringify(typeof error === 'string' ? { ok: false, error } : error));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    const timer = setTimeout(() => finish(new EntryError(408, 'entry_request_timeout')), 3000);
    const cleanup = () => { clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort); };
    const finish = (error, body) => { cleanup(); if (error) { req.resume(); reject(error); } else resolve(body); };
    const onData = chunk => { size += chunk.length; if (size > MAX_REQUEST) finish(new EntryError(413, 'entry_request_too_large')); else parts.push(chunk); };
    const onEnd = () => finish(null, Buffer.concat(parts));
    const onError = () => finish(new EntryError(400, 'entry_request_invalid'));
    const onAbort = () => finish(new EntryError(400, 'entry_request_aborted'));
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAbort);
  });
}

function forward(origin, ca, path, method, body, key, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: 'application/json', 'User-Agent': 'PIVNIK-Evotor-Entry/1.0' };
    if (method === 'POST') { headers['Content-Type'] = 'application/json; charset=utf-8'; headers['Content-Length'] = String(body.length); }
    if (key) headers['X-Pivnik-Device-Key'] = key;
    // Host, Authorization, Cookie, forwarding and hop-by-hop headers are never copied.
    // The device key is sent only to this fixed HTTPS upstream; no retry is made.
    const outgoing = httpsRequest({
      protocol: 'https:', hostname: origin.hostname, port: origin.port || 443,
      path, method, headers, ca, signal,
    });
    const timer = setTimeout(() => outgoing.destroy(new EntryError(504, 'entry_upstream_timeout')), timeoutMs);
    const fail = error => { clearTimeout(timer); reject(error instanceof EntryError ? error : new EntryError(502, 'entry_upstream_unavailable')); };
    outgoing.once('error', fail);
    outgoing.once('response', upstream => {
      const status = upstream.statusCode || 502;
      if (status >= 300 && status < 400) {
        fail(new EntryError(502, 'entry_upstream_redirect')); upstream.destroy(); outgoing.destroy(); return;
      }
      const parts = []; let size = 0;
      upstream.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE) { fail(new EntryError(502, 'entry_upstream_too_large')); upstream.destroy(); outgoing.destroy(); }
        else parts.push(chunk);
      });
      upstream.once('error', fail);
      upstream.once('aborted', () => fail(new EntryError(502, 'entry_upstream_incomplete')));
      upstream.once('end', () => { clearTimeout(timer); resolve({ status, headers: upstream.headers, body: Buffer.concat(parts) }); });
    });
    outgoing.end(body);
  });
}

// The optional origin/CA are dependency injection for TLS integration fixtures.
// Production startup accepts only PORT; incoming URLs cannot select an upstream.
export function createEntry({ origin = PRODUCTION_ORIGIN, ca, timeoutMs = 6000, maxConcurrent = 32 } = {}) {
  const upstream = new URL(origin);
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error('HTTPS origin required');
  let active = 0;
  return createServer({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 8000, connectionsCheckingInterval: 1000 }, async (req, res) => {
    // A disconnect can emit an error after the bounded-body reader has finished.
    req.on('error', () => {});
    if (req.url === '/ready' && req.method === 'GET') { json(res, 200, { ok: true, entry: 'pivnik-evotor-https-entry', upstreamVerified: false }); return; }
    const expected = ROUTES.get(req.url);
    if (!expected) { json(res, 404, 'entry_not_found'); return; }
    if (req.method !== expected) { res.setHeader('Allow', expected); json(res, 405, 'entry_method_not_allowed'); return; }
    if (active >= maxConcurrent) { json(res, 503, 'entry_busy'); return; }
    const key = req.headers['x-pivnik-device-key'];
    if (key !== undefined && (typeof key !== 'string' || key.length > 1024)) { json(res, 400, 'entry_key_header_invalid'); return; }
    if (req.method === 'POST' && String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { json(res, 415, 'entry_json_required'); return; }
    active++;
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const body = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
      if (res.destroyed) return;
      const result = await forward(upstream, ca, req.url, req.method, body, key, timeoutMs, controller.signal);
      if (res.destroyed) return;
      const headers = { 'Cache-Control': 'no-store', 'Connection': 'close', 'X-Pivnik-Entry': '1' };
      for (const name of ['content-type', 'x-railway-request-id', 'x-railway-edge']) {
        if (typeof result.headers[name] === 'string') headers[name] = result.headers[name];
      }
      res.writeHead(result.status, headers); res.end(result.body);
    } catch (error) {
      json(res, error instanceof EntryError ? error.status : 502, error instanceof EntryError ? error.code : 'entry_unavailable');
    } finally { active--; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  createEntry().listen(port, '0.0.0.0', () => console.log('PIVNIK Evotor HTTPS entry listening'));
}
