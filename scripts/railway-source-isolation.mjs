#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';

const SHA = /^[a-f0-9]{40}$/i;
const repo = 'GrafTrahula666/pivnik-bonus-app';

function requireEvidence(condition, message) {
  if (!condition) throw new Error(`Railway source isolation NOT verified: ${message}`);
}

/**
 * Read-only, offline preflight for a sanitized Railway config snapshot.
 * A branch-tracking GitHub source is unsafe even if checkSuites is true or
 * watchPatterns currently exclude some files. Only an exact commit pin can
 * be established from the connector fields available today.
 *
 * Passing this check is NOT evidence of a live Railway source readback,
 * an approval, a valid release gate, successful smoke, or safe rollback.
 */
export function verifyRailwaySourceIsolation(snapshot, approvedSha) {
  requireEvidence(typeof approvedSha === 'string' && SHA.test(approvedSha), 'approved SHA must be exactly 40 hex characters');
  requireEvidence(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot), 'snapshot is required');
  requireEvidence(snapshot.projectId === RAILWAY_PRODUCTION.projectId, 'unexpected project');
  requireEvidence(snapshot.environmentId === RAILWAY_PRODUCTION.environmentId &&
    snapshot.environmentName === 'production', 'unexpected environment');
  requireEvidence(snapshot.staged === null, 'environment has staged changes or no staged-change evidence');
  requireEvidence(Array.isArray(snapshot.services) && snapshot.services.length === 2,
    'exactly two production services are required');

  const services = new Map();
  for (const service of snapshot.services) {
    requireEvidence(service && typeof service === 'object' && !services.has(service.id),
      'service IDs must be present and unique');
    services.set(service.id, service);
  }

  for (const [name, id] of Object.entries({
    telegram: RAILWAY_PRODUCTION.services.telegram,
    vk: RAILWAY_PRODUCTION.services.vk,
  })) {
    const service = services.get(id);
    requireEvidence(service && service.state === 'live' && service.staged === null,
      `${name}: service missing, not live or has staged changes`);
    requireEvidence(service.config?.source?.repo === repo,
      `${name}: unexpected repository source`);
    const pinnedSha = service.config.source.commitSha;
    requireEvidence(typeof pinnedSha === 'string' && SHA.test(pinnedSha) &&
      pinnedSha.toLowerCase() === approvedSha.toLowerCase(),
      `${name}: GitHub source follows branch or is pinned to a different SHA`);
  }
  return { isolated: true, source: 'pinned-commit', sha: approvedSha.toLowerCase(), services: 2 };
}

async function main() {
  requireEvidence(process.argv.length === 4,
    'usage: node scripts/railway-source-isolation.mjs <sanitized-snapshot.json> <approved-main-sha>');
  const data = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const verified = verifyRailwaySourceIsolation(data, process.argv[3]);
  console.log(`Offline Railway source policy passed: two sources pinned to ${verified.sha}.`);
  console.log('WARNING: the supplied snapshot is not independently authenticated; live Railway readback and release gate are still required.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
