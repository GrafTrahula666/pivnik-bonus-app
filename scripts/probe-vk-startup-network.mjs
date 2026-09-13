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
    return { record: {
      url, finalUrl: response.url, status: response.status, elapsedMs: Math.round(performance.now() - started),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      headers: Object.fromEntries(responseHeaders.map((name) => [name, response.headers.get(name)]))
    }, body: new TextDecoder().decode(bytes) };
  } catch (error) {
    return { record: { url, error: safeError(error), elapsedMs: Math.round(performance.now() - started) }, body: '' };
  }
}
function transport(baseUrl, family) {
  return new Promise((resolve) => {
    const started = performance.now();
    let tls = null;
    const request = https.get(new URL('/api/health', baseUrl), {
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
const report = { observedAt: new Date().toISOString(),
  vantage: 'runner network; not a VK device or a Russian mobile network',
  scope: 'public GET endpoints and assets; does not verify signed auth or boot completion', services };
const output = process.env.VK_STARTUP_NETWORK_REPORT || 'artifacts/vk-startup-network.json';
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
const failures = services.flatMap((service) => service.requests.filter((request) =>
  new URL(request.url).pathname === '/api/bootstrap' ? request.status !== 401 : request.status !== 200));
if (failures.length || services.find((service) => service.platform === 'vk')?.externalAssets.length) process.exitCode = 1;
