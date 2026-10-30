import express from 'express';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { connectDatabase } from './db.js';
import { Auth, readAccounts, passwordHash } from './auth.js';
import { Engine, projection } from './engine.js';
import { LiveError, resolveGuest } from './source.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));
const allowedViews = { owner: ['control', 'scanner', 'screen'], operator: ['control', 'scanner', 'screen'], scanner: ['scanner'], screen: ['screen'] };
const cookieToken = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('pivnik_live='))?.slice(12) || '';

export async function createApplication({ db, accounts, origin, secure = true, rewardBridge, scannerAccessToken }) {
  const app = express();
  const auth = new Auth(db, accounts);
  const engine = new Engine(db, { rewardBridge });
  const streams = new Set();
  let ticking = false;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'https:', 'data:'],
    connectSrc: ["'self'"], mediaSrc: ["'self'", 'blob:'], workerSrc: ["'self'", 'blob:'],
    upgradeInsecureRequests: secure ? [] : null
  } } }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) return res.status(403).json({ error: 'invalid_origin' });
    next();
  });
  app.use(express.json({ limit: '8kb', strict: true }));
  const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const cookie = (res, token, age) => res.cookie('pivnik_live', token, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: age });
  app.get('/health', (_req, res) => res.json({ ok: true, mode: db.demo ? 'demo' : 'live' }));
  app.post('/api/demo-scanner', route(async (req, res) => {
    if (!db.demo) throw new LiveError('forbidden', 403);
    const current = await auth.session(cookieToken(req));
    if (current && allowedViews[current.role]?.includes('scanner')) return res.json(current);
    const session = await auth.openDemoScanner();
    cookie(res, session.token, 12 * 3600_000);
    res.json({ account: session.account, role: session.role });
  }));
  app.post('/api/scanner-link', route(async (req, res) => {
    const current = await auth.session(cookieToken(req));
    if (current && allowedViews[current.role]?.includes('scanner')) return res.json(current);
    const session = await auth.openScannerLink(req.body?.token, scannerAccessToken);
    cookie(res, session.token, 12 * 3600_000);
    res.json({ account: session.account, role: session.role });
  }));
  app.post('/api/login', route(async (req, res) => {
    const session = await auth.login(req.body?.account, req.body?.password, req.ip);
    cookie(res, session.token, 12 * 3600_000);
    res.json({ account: session.account, role: session.role });
  }));
  app.use('/api', (req, _res, next) => {
    auth.session(cookieToken(req)).then(actor => {
      if (!actor) return next(new LiveError('login_required', 401));
      req.actor = actor; next();
    }).catch(next);
  });
  app.get('/api/me', (req, res) => res.json(req.actor));
  app.post('/api/qr/resolve', route(async (req, res) => {
    if (!['owner', 'operator', 'scanner'].includes(req.actor.role)) throw new LiveError('forbidden', 403);
    res.json({ guest: await db.exclusive(c => resolveGuest(c, req.body?.payload)) });
  }));
  app.post('/api/logout', route(async (req, res) => { await auth.logout(cookieToken(req)); cookie(res, '', 0); res.json({ ok: true }); }));
  const viewOf = req => {
    const view = req.query.view || 'control';
    if (!allowedViews[req.actor.role]?.includes(view)) throw new LiveError('forbidden', 403);
    return view;
  };
  app.get('/api/state', route(async (req, res) => res.json(projection(await engine.read(), viewOf(req)))));
  app.get('/api/events', route(async (req, res) => {
    const view = viewOf(req);
    if (streams.size >= 40) throw new LiveError('too_many_screens', 429);
    const initial = projection(await engine.read(), view);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const stream = { req, res, view, last: '' };
    streams.add(stream);
    res.write(`data: ${JSON.stringify(initial)}\n\n`);
    req.on('close', () => streams.delete(stream));
  }));
  app.post('/api/actions/:action', route(async (req, res) => {
    res.json(await engine.execute(req.actor, req.params.action, req.body || {}, req.headers['idempotency-key']));
  }));
  app.get('/api/audit', route(async (req, res) => {
    if (req.actor.role !== 'owner') throw new LiveError('forbidden', 403);
    res.json(await engine.audit());
  }));
  app.get('/api/report', route(async (req, res) => {
    if (!['owner', 'operator'].includes(req.actor.role)) throw new LiveError('forbidden', 403);
    res.setHeader('Content-Disposition', 'attachment; filename="pivnik-halloween-report.json"');
    res.json(await engine.read());
  }));
  app.use(express.static(publicDir, { index: false, maxAge: 0, setHeaders: (res, path) => {
    if (path.endsWith('sw.js') || path.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  app.get(['/', '/scanner', '/control', '/screen'], (_req, res) => res.sendFile(resolve(publicDir, 'index.html')));
  app.use((err, _req, res, _next) => {
    const known = err instanceof LiveError || ['not_due', 'not_closed', 'snapshot_mismatch', 'unknown_draw'].includes(err.code);
    const status = err instanceof LiveError ? err.status : known ? 409 : err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 503;
    // Never log raw errors, SQL, bodies, passwords or personal QR tokens.
    res.status(status).json({ error: known ? err.code : status === 400 ? 'invalid_json' : 'service_unavailable' });
  });
  const timer = setInterval(async () => {
    if (ticking || !streams.size) return;
    ticking = true;
    try {
      const state = await engine.read();
      for (const stream of streams) {
        const actor = await auth.session(cookieToken(stream.req));
        if (!actor || !allowedViews[actor.role]?.includes(stream.view)) { stream.res.end(); streams.delete(stream); continue; }
        const data = JSON.stringify(projection(state, stream.view));
        if (data !== stream.last) {
          if (stream.res.writableLength > 256 * 1024) { stream.res.end(); streams.delete(stream); continue; }
          stream.res.write(`data: ${data}\n\n`); stream.last = data;
        } else stream.res.write(': connected\n\n');
      }
    } catch {
      for (const s of streams) { s.res.write('event: unavailable\ndata: {}\n\n'); }
    } finally { ticking = false; }
  }, 1000);
  timer.unref();
  return { app, auth, engine, close: () => { clearInterval(timer); for (const s of streams) s.res.end(); } };
}

export function createRewardBridge(env) {
  if (env.LIVE_ENABLE_REWARD_BRIDGE !== 'true') return undefined;
  const base = new URL(env.LIVE_REWARD_API_ORIGIN);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !env.LIVE_REWARD_SESSION_TOKEN) throw new Error('Invalid reward bridge configuration.');
  return async ({ userId, amount, requestKey }) => {
    const response = await fetch(new URL(`/api/admin/users/${encodeURIComponent(userId)}/adjust`, base), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LIVE_REWARD_SESSION_TOKEN}` },
      body: JSON.stringify({ amount, reason: 'Приз PIVNIK Halloween Live', requestKey })
    });
    if (!response.ok || (await response.json()).ok !== true) throw new LiveError('reward_operation_failed', 503);
  };
}

export async function start(env = process.env) {
  const mode = env.LIVE_MODE;
  const port = Number(env.PORT || 4317);
  const dataDir = env.LIVE_DATA_DIR || fileURLToPath(new URL('../.data/demo', import.meta.url));
  const railwayOrigin = env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '';
  const origin = env.LIVE_PUBLIC_ORIGIN || (mode === 'demo' ? railwayOrigin || `http://localhost:${port}` : '');
  if (!origin || new URL(origin).origin !== origin || (mode === 'live' && !origin.startsWith('https://'))) throw new Error('LIVE_PUBLIC_ORIGIN must be the exact HTTPS origin.');
  const db = await connectDatabase({ mode, url: env.LIVE_DATABASE_URL, dataDir });
  let accountConfig = env.LIVE_ACCOUNTS_JSON;
  if (mode === 'demo' && !accountConfig) {
    const configFile = resolve(dataDir, '../demo-accounts.json');
    try { accountConfig = await readFile(configFile, 'utf8'); } catch {
      const codes = ['owner', 'scanner', 'screen'].map(role => ({ role, name: role, password: randomBytes(12).toString('hex') }));
      accountConfig = JSON.stringify(codes.map(a => ({ name: a.name, role: a.role, passwordHash: passwordHash(a.password) })));
      await writeFile(configFile, accountConfig, { mode: 0o600 });
      await writeFile(resolve(dataDir, '../demo-access.txt'), codes.map(a => `${a.name}: ${a.password}`).join('\n'), { mode: 0o600 });
      console.log('DEMO access codes saved privately in .data/demo-access.txt');
    }
  }
  const application = await createApplication({ db, accounts: readAccounts(accountConfig), origin, secure: mode === 'live', rewardBridge: createRewardBridge(env), scannerAccessToken: env.LIVE_SCANNER_ACCESS_TOKEN });
  if (env.LIVE_TRUST_PROXY === '1') application.app.set('trust proxy', 1);
  const server = application.app.listen(port, env.LIVE_BIND || '127.0.0.1', () => console.log(`PIVNIK Halloween Live (${mode}): ${origin}/control`));
  const close = async () => { application.close(); await new Promise(resolve => server.close(resolve)); await db.close(); };
  process.once('SIGTERM', () => close().then(() => process.exit(0)));
  process.once('SIGINT', () => close().then(() => process.exit(0)));
  return { ...application, server, db, close };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch(() => { console.error('Startup refused. Check live configuration and manual schema setup. No fallback was used.'); process.exitCode = 1; });
}
