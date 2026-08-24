import { productionUrl } from './railway-production-config.mjs';

const services = [
  {
    name: 'telegram',
    baseUrl: productionUrl('telegram', process.env.TELEGRAM_APP_URL)
  },
  {
    name: 'vk',
    baseUrl: productionUrl('vk', process.env.VK_APP_URL)
  }
];

const paths = [
  '/',
  '/vk',
  '/api/health',
  '/api/platform-health',
  '/api/release-readiness',
  '/legal/privacy',
  '/legal/terms'
];

function sanitize(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/(authorization|token|secret|password)(["'\s:=]+)[^\s,"'<>]+/gi, '$1$2[REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 800);
}

async function probe(service, pathname) {
  const url = new URL(pathname, service.baseUrl);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'user-agent': 'pivnik-release-probe/2.0',
        accept: pathname.startsWith('/api/') ? 'application/json' : 'text/html,*/*;q=0.8'
      }
    });
    const body = await response.text();
    const failures = [];
    if (!response.ok) failures.push(`HTTP ${response.status}`);

    if (pathname.startsWith('/api/')) {
      let json;
      try { json = JSON.parse(body); }
      catch { failures.push('invalid JSON'); }
      if (json && json.ok !== true) failures.push('ok is not true');
    }
    if (pathname === '/' && service.name === 'telegram' && !body.includes('telegram-web-app.js')) {
      failures.push('Telegram document is missing the Telegram SDK');
    }
    if ((pathname === '/vk' || (pathname === '/' && service.name === 'vk'))
        && !body.includes('/vk-platform.js')) {
      failures.push('VK document is missing the VK runtime');
    }

    return {
      service,
      pathname,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      body,
      failures
    };
  } catch (error) {
    return {
      service,
      pathname,
      status: null,
      contentType: '',
      body: '',
      failures: [sanitize(error?.message || error)]
    };
  }
}

const results = await Promise.all(
  services.flatMap((service) => paths.map((pathname) => probe(service, pathname)))
);

for (const service of services) {
  console.log(`\n=== ${service.name.toUpperCase()} ${service.baseUrl} ===`);
  for (const result of results.filter((item) => item.service === service)) {
    const outcome = result.status === null
      ? `ERROR ${result.failures.join('; ')}`
      : `HTTP ${result.status} ${result.contentType}`;
    console.log(`${result.pathname} -> ${outcome}`);
    console.log(sanitize(result.body));
  }
}

const failures = results.flatMap((result) => result.failures.map(
  (failure) => `${result.service.name}${result.pathname}: ${failure}`
));
const reachable = results.filter((result) => result.status !== null).length;
console.log(`\nProbe completed. Reachable responses: ${reachable}/${results.length}.`);
if (failures.length) {
  console.error(`Production probe failed: ${failures.join('; ')}`);
  process.exitCode = 1;
}
