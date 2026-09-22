import crypto from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { productionUrl } from './railway-production-config.mjs';

// Public requests only. No application credentials, signed launches, account
// creation, restart or deployment mutations. This observes the deployed release,
// which can differ from the pull request running the probe.
const resolver = new Resolver({ timeout: 5000, tries: 1 });
const safeError = (error) => String(error?.cause?.code || error?.code || error?.name || 'UNKNOWN')
  .replace(/[^A-Z0-9_]/gi, '').slice(0, 48);
const responseHeaders = [
  'content-type', 'content-encoding', 'cache-control', 'content-security-policy',
  'x-frame-options', 'referrer-policy', 'access-control-allow-origin',
  'access-control-allow-methods', 'access-control-allow-headers',
  'strict-transport-security', 'alt-svc'
];

async function get(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000), redirect: 'follow',
      headers: { 'user-agent': 'pivnik-vk-startup-readonly-probe/1.1' }
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pathname = new URL(url).pathname;
    const contentType = response.headers.get('content-type') || '';
    const validAssetType = pathname.endsWith('.js') ? /(?:java|ecma)script/i.test(contentType)
      : pathname.endsWith('.css') ? /^text\/css\b/i.test(contentType) : true;
    return { record: {
      url, finalUrl: response.url, status: response.status, elapsedMs: Math.round(performance.now() - started),
      validAssetType,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      headers: Object.fromEntries(responseHeaders.map((name) => [name, response.headers.get(name)]))
    }, body: new TextDecoder().decode(bytes) };
  } catch (error) {
    return { record: { url, error: safeError(error), elapsedMs: Math.round(performance.now() - started) }, body: '' };
  }
}

async function preflight(url, origin) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      signal: AbortSignal.timeout(15_000),
      redirect: 'manual',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type,x-pivnik-version,x-pivnik-platform,x-pivnik-explicit-consent,x-staff-session',
        'user-agent': 'pivnik-vk-startup-readonly-probe/1.1'
      }
    });
    await response.arrayBuffer();
    return {
      url, origin, status: response.status, elapsedMs: Math.round(performance.now() - started),
      headers: Object.fromEntries(responseHeaders.map((name) => [name, response.headers.get(name)]))
    };
  } catch (error) {
    return { url, origin, error: safeError(error), elapsedMs: Math.round(performance.now() - started) };
  }
}

function transport(baseUrl, family, pathname = '/api/health') {
  return new Promise((resolve) => {
    const started = performance.now();
    let tls = null;
    const request = https.get(new URL(pathname, baseUrl), {
      family, headers: { 'user-agent': 'pivnik-vk-startup-readonly-probe/1.1' }
    }, (response) => {
      response.resume();
      resolve({ family, status: response.statusCode, elapsedMs: Math.round(performance.now() - started), tls });
    });
    const deadline = setTimeout(() => request.destroy(Object.assign(new Error(), { code: 'PROBE_TIMEOUT' })), 15_000);
    request.on('socket', (socket) => socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      tls = { authorized: socket.authorized, protocol: socket.getProtocol(),
        alpn: socket.alpnProtocol || 'http/1.1', issuer: cert.issuer?.CN || null,
        validFrom: cert.valid_from, validTo: cert.valid_to };
    }));
    request.on('error', (error) => resolve({ family, error: safeError(error), elapsedMs: Math.round(performance.now() - started) }));
    request.on('close', () => clearTimeout(deadline));
  });
}

async function dnsFor(url) {
  const hostname = new URL(url).hostname;
  const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  return results.map((result, index) => ({
    family: index === 0 ? 4 : 6,
    ...(result.status === 'fulfilled' ? { addresses: result.value } : { error: safeError(result.reason) })
  }));
}

async function deployedNativeConfig() {
  const [runbook, workflow] = await Promise.all([
    fs.readFile(new URL('../ops/VK-NATIVE-HOSTING-RUNBOOK.md', import.meta.url), 'utf8'),
    fs.readFile(new URL('../.github/workflows/vk-native-hosting-production.yml', import.meta.url), 'utf8')
  ]);
  const hostingUrl = process.env.PIVNIK_VK_NATIVE_PRODUCTION_URL
    || runbook.match(/https:\/\/prod-app54694987-[a-z0-9-]+\.pages-ac\.vk-apps\.(?:ru|com)\/index\.html/i)?.[0];
  const gatewayUrl = process.env.PIVNIK_VK_GATEWAY_URL
    || workflow.match(/PIVNIK_VK_API_BASE:\s*(https:\/\/[^\s]+)/)?.[1];
  if (!hostingUrl) throw new Error('VK native production Hosting URL is missing from runbook.');
  if (!gatewayUrl) throw new Error('VK production gateway URL is missing from deployment workflow.');
  return { hostingUrl, gatewayUrl: gatewayUrl.replace(/\/+$/, '') };
}

function parseRuntimeGateway(html) {
  const match = html.match(/window\.__PIVNIK_VK_API_BASE__\s*=\s*("https:[^"]+")\s*;/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch { return null; }
}

const services = [];
for (const platform of ['vk', 'telegram']) {
  const baseUrl = productionUrl(platform);
  const dns = await dnsFor(baseUrl);
  const paths = ['/', '/api/health', '/api/platform-health', '/api/release-readiness', '/api/bootstrap'];
  const [requests, transports] = await Promise.all([
    Promise.all(paths.map((pathname) => get(new URL(pathname, baseUrl).href))),
    Promise.all([transport(baseUrl, 4), transport(baseUrl, 6)])
  ]);
  const html = requests[0].body;
  const assetUrls = [...new Set([...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], baseUrl).href))];
  const externalAssets = assetUrls.filter((url) => new URL(url).origin !== new URL(baseUrl).origin);
  const localAssets = await Promise.all(assetUrls.filter((url) => new URL(url).origin === new URL(baseUrl).origin).map(get));
  let readiness = null;
  try {
    const value = JSON.parse(requests[3].body);
    readiness = Object.fromEntries(['ok', 'releaseCommit', 'startupRuntimeHashes', 'environment', 'accountMode']
      .map((key) => [key, value[key] ?? null]));
  } catch { /* status and hash still recorded */ }
  services.push({ platform, baseUrl, dns, transports, readiness, externalAssets,
    requests: [...requests, ...localAssets].map((result) => result.record)
  });
}

const { hostingUrl, gatewayUrl } = await deployedNativeConfig();
const hostingOrigin = new URL(hostingUrl).origin;
const gatewayOrigin = new URL(gatewayUrl).origin;
const nativeIndex = await get(hostingUrl);
const nativeAssetUrls = [...new Set([...nativeIndex.body.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)]
  .map((match) => new URL(match[1], hostingUrl).href))];
const nativeLocalAssets = await Promise.all(nativeAssetUrls
  .filter((url) => new URL(url).origin === hostingOrigin)
  .map(get));
const runtimeGateway = parseRuntimeGateway(nativeIndex.body);
const [gatewayHealth, gatewayReady, gatewayCors, nativeDns, gatewayDns, nativeTransports, gatewayTransports] = await Promise.all([
  get(new URL('/healthz', gatewayUrl).href),
  get(new URL('/readyz', gatewayUrl).href),
  preflight(new URL('/api/me', gatewayUrl).href, hostingOrigin),
  dnsFor(hostingUrl),
  dnsFor(gatewayUrl),
  Promise.all([transport(hostingOrigin, 4, '/index.html'), transport(hostingOrigin, 6, '/index.html')]),
  Promise.all([transport(gatewayOrigin, 4, '/healthz'), transport(gatewayOrigin, 6, '/healthz')])
]);

let gatewayReadiness = null;
try { gatewayReadiness = JSON.parse(gatewayReady.body); }
catch { /* status and body hash still recorded */ }

const nativeVk = {
  hostingUrl,
  hostingOrigin,
  gatewayUrl,
  gatewayOrigin,
  runtimeGateway,
  runtimeGatewayMatchesExpected: runtimeGateway === gatewayOrigin,
  forbiddenBrowserOrigins: {
    railway: /(?:^|[."'/:])[^"' ]*up\.railway\.app/i.test(nativeIndex.body),
    vercel: /(?:^|[."'/:])[^"' ]*vercel\.app/i.test(nativeIndex.body),
    telegramRuntime: /telegram\.org\/js\/telegram-web-app\.js/i.test(nativeIndex.body)
  },
  dns: { hosting: nativeDns, gateway: gatewayDns },
  transports: { hosting: nativeTransports, gateway: gatewayTransports },
  requests: {
    hosting: [nativeIndex, ...nativeLocalAssets].map((result) => result.record),
    gatewayHealth: gatewayHealth.record,
    gatewayReady: gatewayReady.record,
    gatewayCors
  },
  gatewayReadiness
};

const report = { observedAt: new Date().toISOString(),
  vantage: 'GitHub runner network; not a VK device or a Russian mobile network',
  scope: 'public Railway + VK Hosting + gateway network path; does not verify signed auth or boot completion',
  services, nativeVk };
const output = process.env.VK_STARTUP_NETWORK_REPORT || 'artifacts/vk-startup-network.json';
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

const failures = services.flatMap((service) => service.requests.filter((request) =>
  new URL(request.url).pathname === '/api/bootstrap' ? request.status !== 401 : request.status !== 200 || !request.validAssetType));
const nativeFailures = nativeVk.requests.hosting.filter((request) => request.status !== 200 || !request.validAssetType);
const expectedVkRelease = services.find((service) => service.platform === 'vk')?.readiness?.releaseCommit || null;
const observedGatewayRelease = gatewayReadiness?.upstream?.releaseCommit || null;
const invalidNativePath = nativeFailures.length
  || nativeVk.requests.gatewayHealth.status !== 200
  || nativeVk.requests.gatewayReady.status !== 200
  || nativeVk.requests.gatewayCors.status !== 204
  || nativeVk.requests.gatewayCors.headers?.['access-control-allow-origin'] !== hostingOrigin
  || !nativeVk.runtimeGatewayMatchesExpected
  || Object.values(nativeVk.forbiddenBrowserOrigins).some(Boolean)
  || gatewayReadiness?.ok !== true
  || gatewayReadiness?.upstream?.vk !== true
  || (expectedVkRelease && observedGatewayRelease !== expectedVkRelease);

if (failures.length || services.find((service) => service.platform === 'vk')?.externalAssets.length || invalidNativePath) {
  process.exitCode = 1;
}
