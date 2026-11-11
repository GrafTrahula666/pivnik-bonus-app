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

/**
 * Reconcile actual read-only Railway connector shapes rather than manually
 * copying service/source fields into an operator-authored manifest.
 * The connector responses still need independent trusted acquisition and
 * may change between calls; this does not attest the Source UI toggle.
 */
export function snapshotFromRailwayReadbacks(environmentReadback, serviceReadbacks) {
  requireEvidence(environmentReadback && typeof environmentReadback === 'object' &&
    environmentReadback.project?.id === RAILWAY_PRODUCTION.projectId &&
    environmentReadback.environment?.id === RAILWAY_PRODUCTION.environmentId &&
    environmentReadback.environment?.name === 'production',
    'invalid Railway environment readback');
  requireEvidence(environmentReadback.staged === null, 'environment readback contains staged changes');
  requireEvidence(Array.isArray(environmentReadback.services), 'environment service inventory is missing');
  requireEvidence(Array.isArray(serviceReadbacks) && serviceReadbacks.length === 2,
    'exactly two service config readbacks are required');

  const expectedIds = new Set([RAILWAY_PRODUCTION.services.telegram, RAILWAY_PRODUCTION.services.vk]);
  const seen = new Set();
  const services = serviceReadbacks.map(readback => {
    const id = readback?.service?.id;
    requireEvidence(expectedIds.has(id) && !seen.has(id), 'unknown or duplicate service config readback');
    seen.add(id);
    requireEvidence(readback.environment?.id === RAILWAY_PRODUCTION.environmentId &&
      readback.staged === null, 'service config readback belongs to a different or staged environment');
    const matches = environmentReadback.services.filter(service => service.id === id);
    requireEvidence(matches.length === 1, 'service not uniquely present in environment inventory');
    const discovered = matches[0];
    requireEvidence(discovered.state === 'live' && discovered.stagedChangeCount === 0,
      'environment service is not live or has staged changes');
    const environmentSource = discovered.source;
    const configSource = readback.config?.source;
    requireEvidence(environmentSource?.repo === configSource?.repo &&
      environmentSource?.branch === configSource?.branch &&
      environmentSource?.image === (configSource?.image ?? null) &&
      // A commit pin can be surfaced by either Railway read endpoint. Never
      // accept conflicting pins, or a pin present in only one readback.
      (environmentSource?.commitSha ?? null) === (configSource?.commitSha ?? null),
      'Railway source mismatch between environment and service readbacks');
    return { id, state: discovered.state, staged: readback.staged, config: readback.config };
  });

  return {
    projectId: environmentReadback.project.id,
    environmentId: environmentReadback.environment.id,
    environmentName: environmentReadback.environment.name,
    staged: environmentReadback.staged,
    services,
  };
}

async function main() {
  const isReadback = process.argv[2] === '--connector-readbacks';
  requireEvidence(isReadback ? process.argv.length === 5 : process.argv.length === 4,
    'usage: node scripts/railway-source-isolation.mjs [--connector-readbacks] <sanitized-json> <approved-main-sha>');
  const file = isReadback ? process.argv[3] : process.argv[2];
  const approvedSha = isReadback ? process.argv[4] : process.argv[3];
  const data = JSON.parse(await readFile(file, 'utf8'));
  const snapshot = isReadback
    ? snapshotFromRailwayReadbacks(data.environment, data.serviceConfigs)
    : data;
  const verified = verifyRailwaySourceIsolation(snapshot, approvedSha);
  console.log(`Offline Railway source policy passed: two sources pinned to ${verified.sha}.`);
  console.log('WARNING: the supplied snapshot is not independently authenticated; live Railway readback and release gate are still required.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
