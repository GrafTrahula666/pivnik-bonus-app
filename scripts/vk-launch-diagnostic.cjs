const http = require('node:http');

const port = Number(process.env.PORT || 8080);
const startedAt = new Date().toISOString();

function safeHeader(value) {
  return String(value || '').slice(0, 500);
}

function requestSnapshot(req) {
  return {
    at: new Date().toISOString(),
    method: req.method,
    url: req.url,
    host: safeHeader(req.headers.host),
    origin: safeHeader(req.headers.origin),
    referer: safeHeader(req.headers.referer),
    userAgent: safeHeader(req.headers['user-agent']),
    secFetchDest: safeHeader(req.headers['sec-fetch-dest']),
    secFetchMode: safeHeader(req.headers['sec-fetch-mode']),
    secFetchSite: safeHeader(req.headers['sec-fetch-site']),
    xForwardedFor: safeHeader(req.headers['x-forwarded-for'])
  };
}

function securityHeaders(extra = {}) {
  return {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Referrer-Policy': 'no-referrer-when-downgrade',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors https://vk.com https://*.vk.com https://vk.ru https://*.vk.ru",
    ...extra
  };
}

const server = http.createServer((req, res) => {
  const snapshot = requestSnapshot(req);
  console.log('[VK_LAUNCH_DIAGNOSTIC]', JSON.stringify(snapshot));

  if (req.url === '/api/health' || req.url === '/health') {
    res.writeHead(200, securityHeaders({ 'Content-Type': 'application/json; charset=utf-8' }));
    res.end(JSON.stringify({ ok: true, mode: 'vk-launch-diagnostic', startedAt }));
    return;
  }

  if (req.url === '/favicon.ico') {
    res.writeHead(204, securityHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `https://${req.headers.host || 'localhost'}`);
  const launchKeys = Array.from(url.searchParams.keys()).filter((key) => key.startsWith('vk_') || key === 'sign');
  const hasVkAppId = url.searchParams.get('vk_app_id') === '54694987';
  const hasSign = Boolean(url.searchParams.get('sign'));
  const parentHint = safeHeader(req.headers.referer || req.headers.origin);
  const diagnosticId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>VK launch diagnostic</title>
<style>
html,body{margin:0;min-height:100%;background:#12060a;color:#fff;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:720px;margin:0 auto;padding:28px 20px}section{margin-top:16px;padding:18px;border:1px solid rgba(255,255,255,.16);border-radius:16px;background:rgba(255,255,255,.06)}h1{font-size:24px;margin:0 0 10px}p{line-height:1.45}.ok{color:#8df0a8}.bad{color:#ff9b9b}code{word-break:break-word;color:#ffd98e}small{opacity:.7}</style>
</head>
<body>
<main>
<h1>VK diagnostic reached</h1>
<p class="ok">Если вы видите этот экран внутри VK, запрос до Railway дошёл.</p>
<section>
<p>Path: <code>${url.pathname.replaceAll('<','&lt;')}</code></p>
<p>VK App ID 54694987: <strong class="${hasVkAppId ? 'ok' : 'bad'}">${hasVkAppId ? 'есть' : 'нет'}</strong></p>
<p>Подпись sign: <strong class="${hasSign ? 'ok' : 'bad'}">${hasSign ? 'есть' : 'нет'}</strong></p>
<p>Launch keys: <code>${launchKeys.join(', ') || 'нет'}</code></p>
<p>Источник: <code>${parentHint.replaceAll('<','&lt;') || 'не передан'}</code></p>
</section>
<section><small>Diagnostic ID: ${diagnosticId}</small></section>
</main>
</body>
</html>`;

  res.writeHead(200, securityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'X-Pivnik-Diagnostic': diagnosticId
  }));
  res.end(html);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[VK_LAUNCH_DIAGNOSTIC] listening on ${port}; startedAt=${startedAt}`);
});
