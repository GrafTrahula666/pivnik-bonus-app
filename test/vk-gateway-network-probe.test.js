import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The VK browser client never talks to Railway directly; it only ever reaches
// the Selectel gateway (ops/VK-NATIVE-HOSTING-RUNBOOK.md). The existing
// per-platform loop in this probe only ever requests the raw Railway origin
// (productionUrl('vk')), so it cannot observe the one hop whose reachability
// actually depends on a user's own network/VPN. This guards that a dedicated
// gateway probe exists and is wired into the pass/fail decision.
test('VK startup network probe observes the real Selectel gateway, not just Railway directly', () => {
  const script = read('scripts/probe-vk-startup-network.mjs');

  assert.match(script, /const gatewayUrl = String\(process\.env\.PIVNIK_VK_GATEWAY_URL \|\| 'https:\/\/139\.100\.238\.159\.nip\.io'\)/);
  assert.match(script, /async function probeGateway\(/);
  assert.match(script, /get\(new URL\('\/healthz', baseUrl\)\.href\)/);
  assert.match(script, /get\(new URL\('\/readyz', baseUrl\)\.href\)/);
  assert.match(script, /method: 'OPTIONS'/);
  assert.match(script, /access-control-allow-origin/);

  // A user's own VPN only changes the client -> gateway leg. Everything past
  // the gateway (Vercel relay -> Railway) is identical either way, so a
  // missing AAAA record on the gateway hostname is exactly the kind of
  // client-network-dependent fact this probe must surface, not silently drop.
  assert.match(script, /hasAaaa/);
  assert.match(script, /no AAAA record/);

  const report = script.match(/const report = \{[\s\S]*?services, gateway \};/);
  assert.ok(report, 'report must include the gateway observation, not just the Railway services loop');

  assert.match(script, /gatewayFailures\.push\('gateway healthz did not return 200'\)/);
  assert.match(script, /gatewayFailures\.push\('gateway readyz did not return 200'\)/);
  assert.match(script, /gatewayFailures\.push\('gateway CORS preflight did not return 204'\)/);
  assert.match(script, /gatewayFailures\.push\('gateway CORS allow-origin did not echo the VK Hosting sample origin'\)/);
  assert.match(script, /\|\| gatewayFailures\.length\) \{\s*\n\s*process\.exitCode = 1;/);
});

test('gateway probe transport helper stays reusable for both Railway and Selectel targets', () => {
  const script = read('scripts/probe-vk-startup-network.mjs');
  // transport() must accept a path so the gateway probe can reuse it against
  // /healthz instead of the Railway-only /api/health, without duplicating the
  // TLS/handshake instrumentation.
  assert.match(script, /function transport\(baseUrl, family, pathname = '\/api\/health'\)/);
  assert.match(script, /transport\(baseUrl, 4, '\/healthz'\)/);
  assert.match(script, /transport\(baseUrl, 6, '\/healthz'\)/);
});
