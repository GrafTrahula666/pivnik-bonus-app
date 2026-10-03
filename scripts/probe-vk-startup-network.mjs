import crypto from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { productionUrl } from './railway-production-config.mjs';

// Public GET requests only. No application credentials, signed launches, account
// creation, restart or Railway mutations. This observes the deployed release,
// which can differ from the pull request running the probe.
const resolver = new Resolver({ timeout: 5000, tries: 1 });
const safeError = (error) => String(error?.cause?.code || error?.code || error?.name || 'UNKNOWN')
  .replace(/[^A-Z0-9_]/gi, '').slice(0, 48);
const responseHeaders = [
  'content-type', 'content-encoding', 'cache-control', 'content-security-policy',
  'x-frame-options', 'referrer-policy', 'access-control-allow-origin',
  'strict-transport-security', 'alt-svc'
];
async function get(url) {
  const started = performance.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000), redirect: 'follow',
      headers: { 'user-agent': 'pivnik-vk-startup-readonly-probe/1.0' }
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
function transport(baseUrl, family, pathname = '/api/health') {
  return new Promise((resolve) => {
    const started = performance.now();
    let tls = null;
    const request = https.get(new URL(pathname, baseUrl), {
      family, headers: { 'user-agent': 'pivnik-vk-startup-readonly-probe/1.0' }
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
// The VK browser client never talks to the Railway backend directly — it only
// ever reaches the Selectel gateway (see ops/VK-NATIVE-HOSTING-RUNBOOK.md).
// A user's own VPN only changes the client -> gateway leg; everything past the
// gateway (Vercel relay -> Railway) is identical either way. So this is the
// one hop whose reachability actually explains a "works with VPN, not
// without" report, and the Railway-direct probes below cannot observe it.
const gatewayUrl = String(process.env.PIVNIK_VK_GATEWAY_URL || 'https://139.100.238.159.nip.io').replace(/\/+$/, '');
const vkHostingOriginSample = String(
  process.env.PIVNIK_VK_HOSTING_ORIGIN_SAMPLE || 'https://prod-app54694987-000000000000.pages-ac.vk-apps.ru'
).replace(/\/+$/, '');

function probeCors(baseUrl, originSample, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    const started = performance.now();
    const target = new URL('/api/me', baseUrl);
    const request = https.request(target, {
      method: 'OPTIONS',
      headers: {
        'user-agent': 'pivnik-vk-startup-readonly-probe/1.0',
        origin: originSample,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,content-type,x-pivnik-version,x-pivnik-platform'
      }
    }, (response) => {
      response.resume();
      resolve({
        status: response.statusCode,
        elapsedMs: Math.round(performance.now() - started),
        allowOrigin: response.headers['access-control-allow-origin'] || null
      });
    });
    const deadline = setTimeout(() => request.destroy(Object.assign(new Error(), { code: 'PROBE_TIMEOUT' })), timeoutMs);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', (error) => resolve({ error: safeError(error), elapsedMs: Math.round(performance.now() - started) }));
    request.end();
  });
}

async function probeGateway(baseUrl, originSample) {
  const hostname = new URL(baseUrl).hostname;
  const dns = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  const [health, ready, transports] = await Promise.all([
    get(new URL('/healthz', baseUrl).href),
    get(new URL('/readyz', baseUrl).href),
    Promise.all([transport(baseUrl, 4, '/healthz'), transport(baseUrl, 6, '/healthz')])
  ]);
  const cors = await probeCors(baseUrl, originSample);
  const aaaaRecord = dns[1];
  const hasAaaa = aaaaRecord.status === 'fulfilled' && aaaaRecord.value.length > 0;
  const warnings = [];
  if (!hasAaaa) {
    warnings.push(
      'gateway hostname has no AAAA record (nip.io encodes only the IPv4 literal in the name); '
      + 'an IPv6-only client network without working NAT64 to this address cannot reach it, VPN or not'
    );
  }
  return {
    baseUrl, originSample,
    dns: dns.map((result, index) => ({ family: index === 0 ? 4 : 6,
      ...(result.status === 'fulfilled' ? { addresses: result.value } : { error: safeError(result.reason) }) })),
    transports,
    health: health.record, ready: ready.record, cors, warnings
  };
}

const services = [];
for (const platform of ['vk', 'telegram']) {
  const baseUrl = productionUrl(platform);
  const hostname = new URL(baseUrl).hostname;
  const dns = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
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
  services.push({ platform, baseUrl,
    dns: dns.map((result, index) => ({ family: index === 0 ? 4 : 6,
      ...(result.status === 'fulfilled' ? { addresses: result.value } : { error: safeError(result.reason) }) })),
    transports, readiness, externalAssets,
    requests: [...requests, ...localAssets].map((result) => result.record)
  });
}
const gateway = await probeGateway(gatewayUrl, vkHostingOriginSample);
const report = { observedAt: new Date().toISOString(),
  vantage: 'runner network; not a VK device or a Russian mobile network',
  scope: 'public GET endpoints and assets; does not verify signed auth or boot completion', services, gateway };
const output = process.env.VK_STARTUP_NETWORK_REPORT || 'artifacts/vk-startup-network.json';
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
const failures = services.flatMap((service) => service.requests.filter((request) =>
  new URL(request.url).pathname === '/api/bootstrap' ? request.status !== 401 : request.status !== 200 || !request.validAssetType));
const gatewayFailures = [];
if (gateway.health.status !== 200) gatewayFailures.push('gateway healthz did not return 200');
if (gateway.ready.status !== 200) gatewayFailures.push('gateway readyz did not return 200');
if (gateway.cors.status !== 204) gatewayFailures.push('gateway CORS preflight did not return 204');
if (gateway.cors.allowOrigin !== vkHostingOriginSample) gatewayFailures.push('gateway CORS allow-origin did not echo the VK Hosting sample origin');
if (gateway.warnings.length) console.warn('VK gateway warnings:', gateway.warnings.join('; '));
if (gatewayFailures.length) console.error('VK gateway failures:', gatewayFailures.join('; '));
if (failures.length || services.find((service) => service.platform === 'vk')?.externalAssets.length || gatewayFailures.length) {
  process.exitCode = 1;
}
