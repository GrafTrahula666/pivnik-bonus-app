const services = [
  {
    name: 'telegram',
    baseUrl: 'https://pivnik-bonus-app-production-df60.up.railway.app'
  },
  {
    name: 'vk',
    baseUrl: 'https://pivnik-vk-test-production-b6b5.up.railway.app'
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

let reachable = 0;

for (const service of services) {
  console.log(`\n=== ${service.name.toUpperCase()} ${service.baseUrl} ===`);
  for (const pathname of paths) {
    const url = new URL(pathname, service.baseUrl);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'user-agent': 'pivnik-release-probe/1.0',
          accept: pathname.startsWith('/api/') ? 'application/json' : 'text/html,*/*;q=0.8'
        }
      });
      const body = await response.text();
      reachable += 1;
      console.log(`${pathname} -> HTTP ${response.status} ${response.headers.get('content-type') || ''}`);
      console.log(sanitize(body));
    } catch (error) {
      console.log(`${pathname} -> ERROR ${sanitize(error?.message || error)}`);
    }
  }
}

console.log(`\nProbe completed. Reachable responses: ${reachable}/${services.length * paths.length}.`);
process.exitCode = 0;
