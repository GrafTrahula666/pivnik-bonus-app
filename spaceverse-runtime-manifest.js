import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNTIME_KEY_PATTERN = /^sv-[0-9a-f]{32}$/;
const CANONICAL_ID_PATTERN = /^[1-9]\d{0,18}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const THEMES = new Set(['premium-dark', 'dark', 'light']);
const APP_FIELDS = Object.freeze([
  'displayName', 'theme', 'primaryColor', 'secondaryColor', 'shopEnabled', 'loyaltyEnabled'
]);
const RUNTIME_BUNDLE_ENTRYPOINTS = Object.freeze(['server.js', 'universal-server.js']);
const RUNTIME_BUNDLE_ARTIFACT = Object.freeze({
  name: 'pivnik-bonus-app',
  contract: 'tenant-runtime-v1',
  entrypoints: RUNTIME_BUNDLE_ENTRYPOINTS
});

export const SPACEVERSE_RUNTIME_BINDING_SQL = `SELECT
  runtime_key,manifest_sha256,manifest_revision,company_id,venue_id,isolation_policy,status
FROM spaceverse_runtime_binding
WHERE singleton=TRUE AND runtime_key=$1
LIMIT 1`;

const verifiedRuntimeContexts = new WeakSet();
const verifiedTenantRuntimes = new WeakSet();

export class SpaceverseRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpaceverseRuntimeError';
    this.code = code;
  }
}

function failure(code, message) {
  return new SpaceverseRuntimeError(code, message);
}

function exactRecord(raw, fields, code = 'SPACEVERSE_RUNTIME_MANIFEST_INVALID') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw failure(code, 'SPACEVERSE runtime manifest is invalid.');
  }
  const value = raw;
  if (Object.keys(value).some((key) => !fields.includes(key))) {
    throw failure(code, 'SPACEVERSE runtime manifest contains unsupported fields.');
  }
  return value;
}

function safeText(raw, { max, pattern, code = 'SPACEVERSE_RUNTIME_MANIFEST_INVALID' }) {
  if (typeof raw !== 'string') throw failure(code, 'SPACEVERSE runtime manifest is invalid.');
  const value = raw.trim();
  if (!value || value.length > max || Array.from(value).some((character) => {
    const point = character.charCodeAt(0);
    return point <= 31 || point === 127;
  }) || (pattern && !pattern.test(value))) {
    throw failure(code, 'SPACEVERSE runtime manifest is invalid.');
  }
  return value;
}

function applicationConfig(raw) {
  const value = exactRecord(raw, APP_FIELDS);
  const displayName = safeText(value.displayName, { max: 120 });
  const theme = safeText(value.theme, { max: 20 });
  const primaryColor = safeText(value.primaryColor, { max: 7 }).toLowerCase();
  const secondaryColor = safeText(value.secondaryColor, { max: 7 }).toLowerCase();
  if (!THEMES.has(theme) || !COLOR_PATTERN.test(primaryColor) || !COLOR_PATTERN.test(secondaryColor)
    || typeof value.shopEnabled !== 'boolean' || typeof value.loyaltyEnabled !== 'boolean') {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  return {
    displayName,
    theme,
    primaryColor,
    secondaryColor,
    shopEnabled: value.shopEnabled,
    loyaltyEnabled: value.loyaltyEnabled
  };
}

function canonicalId(raw) {
  const value = safeText(raw, { max: 19, pattern: CANONICAL_ID_PATTERN });
  if (BigInt(value) > 9_223_372_036_854_775_807n) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  return value;
}

function manifestScope(raw) {
  const value = exactRecord(raw, ['companyId', 'venueId']);
  return { companyId: canonicalId(value.companyId), venueId: canonicalId(value.venueId) };
}

function manifestCore({ draftId, runtimeKey, draftRevision, applicationRevision, scopeRevision, scope, config }) {
  const normalizedDraftId = safeText(draftId, { max: 36, pattern: UUID_PATTERN });
  const normalizedRuntimeKey = safeText(runtimeKey, { max: 35, pattern: RUNTIME_KEY_PATTERN });
  if (!Number.isSafeInteger(draftRevision) || draftRevision < 1 || draftRevision > 2_147_483_647
    || !Number.isSafeInteger(applicationRevision) || applicationRevision < 1 || applicationRevision > 2_147_483_647) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  if (!Number.isSafeInteger(scopeRevision) || scopeRevision !== 1) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  return {
    schemaVersion: 2,
    runtimeKey: normalizedRuntimeKey,
    source: {
      kind: 'onboarding', draftId: normalizedDraftId.toLowerCase(),
      draftRevision, applicationRevision, scopeRevision
    },
    scope: manifestScope(scope),
    application: {
      template: 'standard',
      qrEnabled: true,
      ...applicationConfig(config)
    },
    isolation: { policy: 'dedicated_database', legacyDataAccess: false },
    release: { runtimeStatus: 'not_provisioned', published: false }
  };
}

function digest(core) {
  return crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
}

export function createSpaceverseRuntimeManifest(input) {
  const core = manifestCore(input || {});
  const manifest = {
    ...core,
    source: Object.freeze(core.source),
    scope: Object.freeze(core.scope),
    application: Object.freeze(core.application),
    isolation: Object.freeze(core.isolation),
    release: Object.freeze(core.release),
    manifestSha256: digest(core)
  };
  return Object.freeze(manifest);
}

export function parseSpaceverseRuntimeManifest(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim() || raw.length > 8192) {
      throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
    }
    try { parsed = JSON.parse(raw); }
    catch { throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.'); }
  }
  const value = exactRecord(parsed, [
    'schemaVersion', 'runtimeKey', 'source', 'scope', 'application', 'isolation', 'release', 'manifestSha256'
  ]);
  if (value.schemaVersion !== 2) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  const source = exactRecord(value.source, [
    'kind', 'draftId', 'draftRevision', 'applicationRevision', 'scopeRevision'
  ]);
  const application = exactRecord(value.application, ['template', 'qrEnabled', ...APP_FIELDS]);
  const isolation = exactRecord(value.isolation, ['policy', 'legacyDataAccess']);
  const release = exactRecord(value.release, ['runtimeStatus', 'published']);
  if (source.kind !== 'onboarding' || application.template !== 'standard' || application.qrEnabled !== true
    || isolation.policy !== 'dedicated_database' || isolation.legacyDataAccess !== false
    || release.runtimeStatus !== 'not_provisioned' || release.published !== false) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  const manifest = createSpaceverseRuntimeManifest({
    draftId: source.draftId,
    runtimeKey: value.runtimeKey,
    draftRevision: source.draftRevision,
    applicationRevision: source.applicationRevision,
    scopeRevision: source.scopeRevision,
    scope: value.scope,
    config: Object.fromEntries(APP_FIELDS.map((field) => [field, application[field]]))
  });
  if (value.manifestSha256 !== manifest.manifestSha256) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_DIGEST_MISMATCH', 'SPACEVERSE runtime manifest checksum does not match.');
  }
  return manifest;
}

export function parseSpaceverseRuntimeCodeRelease(raw) {
  if(raw===null)return null;
  const value=exactRecord(raw,['sourceSha','fingerprint','coverage','moduleCount'],'SPACEVERSE_RUNTIME_BUNDLE_INVALID');
  if(typeof value.sourceSha!=='string'||typeof value.fingerprint!=='string'
    ||!/^[0-9a-f]{40}$/.test(value.sourceSha)||!/^[0-9a-f]{64}$/.test(value.fingerprint)
    ||value.coverage!=='node_literal_import_closure'||!Number.isSafeInteger(value.moduleCount)
    ||value.moduleCount<5||value.moduleCount>200)throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID','Runtime code release is invalid.');
  return Object.freeze({...value});
}
export function parseSpaceverseRuntimeImageRelease(raw) {
  if(raw===null)return null;
  const value=exactRecord(raw,['imageId','platform','contract'],'SPACEVERSE_RUNTIME_BUNDLE_INVALID');
  if(typeof value.imageId!=='string'||!/^sha256:[0-9a-f]{64}$/.test(value.imageId)
    ||value.platform!=='linux/amd64'||value.contract!=='tenant-runtime-v1'){
    throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID','Runtime image release is invalid.');
  }
  return Object.freeze({...value});
}
function runtimeBundleCore(rawManifest,rawCodeRelease=null,rawImageRelease=null) {
  const manifest = parseSpaceverseRuntimeManifest(rawManifest);
  const codeRelease=parseSpaceverseRuntimeCodeRelease(rawCodeRelease);
  const imageRelease=parseSpaceverseRuntimeImageRelease(rawImageRelease);
  if(imageRelease&&!codeRelease)throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID','Runtime image requires code proof.');
  return {
    schemaVersion: imageRelease?3:codeRelease?2:1,
    artifact: {
      name: RUNTIME_BUNDLE_ARTIFACT.name,
      contract: RUNTIME_BUNDLE_ARTIFACT.contract,
      entrypoints: [...RUNTIME_BUNDLE_ARTIFACT.entrypoints],
      ...(codeRelease?{codeRelease}:{}),
      ...(imageRelease?{imageRelease}:{})
    },
    manifest,
    release: { runtimeStatus: 'not_provisioned', published: false, startAllowed: false }
  };
}

export function createSpaceverseRuntimeBundle(rawManifest,codeRelease=null,imageRelease=null) {
  const core = runtimeBundleCore(rawManifest,codeRelease,imageRelease);
  return Object.freeze({
    schemaVersion: core.schemaVersion,
    artifact: Object.freeze({
      ...core.artifact,
      entrypoints: Object.freeze(core.artifact.entrypoints)
    }),
    manifest: core.manifest,
    release: Object.freeze(core.release),
    bundleSha256: digest(core)
  });
}

export function parseSpaceverseRuntimeBundle(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim() || raw.length > 16384) {
      throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID', 'SPACEVERSE runtime bundle is invalid.');
    }
    try { parsed = JSON.parse(raw); }
    catch { throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID', 'SPACEVERSE runtime bundle is invalid.'); }
  }
  const value = exactRecord(parsed, [
    'schemaVersion', 'artifact', 'manifest', 'release', 'bundleSha256'
  ], 'SPACEVERSE_RUNTIME_BUNDLE_INVALID');
  const artifact = exactRecord(value.artifact, [
    'name', 'contract', 'entrypoints',...([2,3].includes(value.schemaVersion)?['codeRelease']:[]),...(value.schemaVersion===3?['imageRelease']:[])
  ], 'SPACEVERSE_RUNTIME_BUNDLE_INVALID');
  const release = exactRecord(value.release, [
    'runtimeStatus', 'published', 'startAllowed'
  ], 'SPACEVERSE_RUNTIME_BUNDLE_INVALID');
  if (![1,2,3].includes(value.schemaVersion)
    || artifact.name !== RUNTIME_BUNDLE_ARTIFACT.name
    || artifact.contract !== RUNTIME_BUNDLE_ARTIFACT.contract
    || !Array.isArray(artifact.entrypoints)
    || artifact.entrypoints.length !== RUNTIME_BUNDLE_ENTRYPOINTS.length
    || artifact.entrypoints.some((entrypoint, index) => entrypoint !== RUNTIME_BUNDLE_ENTRYPOINTS[index])
    || release.runtimeStatus !== 'not_provisioned'
    || release.published !== false
    || release.startAllowed !== false) {
    throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID', 'SPACEVERSE runtime bundle is invalid.');
  }
  const bundle = createSpaceverseRuntimeBundle(value.manifest,[2,3].includes(value.schemaVersion)?artifact.codeRelease:null,value.schemaVersion===3?artifact.imageRelease:null);
  if(bundle.schemaVersion!==value.schemaVersion)throw failure('SPACEVERSE_RUNTIME_BUNDLE_INVALID','Runtime bundle proof does not match its version.');
  if (value.bundleSha256 !== bundle.bundleSha256) {
    throw failure('SPACEVERSE_RUNTIME_BUNDLE_DIGEST_MISMATCH', 'SPACEVERSE runtime bundle checksum does not match.');
  }
  return bundle;
}

export function runtimeEnvironmentFromSpaceverseBundle(raw) {
  const bundle = parseSpaceverseRuntimeBundle(raw);
  return Object.freeze({
    SPACEVERSE_RUNTIME_MODE: 'tenant',
    SPACEVERSE_RUNTIME_MANIFEST_JSON: JSON.stringify(bundle.manifest)
  });
}

export function runtimeManifestFromEnvironment(environment = {}) {
  const mode = String(environment.SPACEVERSE_RUNTIME_MODE || '').trim();
  const raw = String(environment.SPACEVERSE_RUNTIME_MANIFEST_JSON || '').trim();
  if ((!mode || mode === 'legacy-pivnik') && !raw) {
    return Object.freeze({ mode: 'legacy-pivnik', manifest: null });
  }
  if (mode !== 'tenant' || !raw) {
    throw failure('SPACEVERSE_RUNTIME_MODE_INVALID', 'SPACEVERSE tenant runtime requires an explicit manifest.');
  }
  return Object.freeze({ mode: 'tenant', manifest: parseSpaceverseRuntimeManifest(raw) });
}

export async function resolveSpaceverseRuntime({ environment = {}, query } = {}) {
  const configured = runtimeManifestFromEnvironment(environment);
  if (configured.mode === 'legacy-pivnik') {
    return Object.freeze({ mode: configured.mode, manifest: null, binding: null, context: null, startAllowed: true });
  }
  if (typeof query !== 'function') {
    throw failure('SPACEVERSE_RUNTIME_BINDING_UNAVAILABLE', 'SPACEVERSE runtime database binding is unavailable.');
  }
  let result;
  try {
    result = await query(SPACEVERSE_RUNTIME_BINDING_SQL, [configured.manifest.runtimeKey]);
  } catch {
    throw failure('SPACEVERSE_RUNTIME_BINDING_UNAVAILABLE', 'SPACEVERSE runtime database binding is unavailable.');
  }
  const row = result?.rows?.[0];
  if (!row || Number(result.rowCount ?? result.rows.length) !== 1
    || row.runtime_key !== configured.manifest.runtimeKey
    || row.manifest_sha256 !== configured.manifest.manifestSha256
    || Number(row.manifest_revision) !== configured.manifest.source.applicationRevision
    || row.company_id !== configured.manifest.scope.companyId
    || row.venue_id !== configured.manifest.scope.venueId
    || row.isolation_policy !== 'dedicated_database'
    || row.status !== 'prepared') {
    throw failure('SPACEVERSE_RUNTIME_BINDING_MISMATCH', 'SPACEVERSE runtime database is not bound to this manifest.');
  }
  const context = Object.freeze({
    companyId: configured.manifest.scope.companyId,
    venueId: configured.manifest.scope.venueId,
    tenantId: configured.manifest.scope.companyId,
    locationId: configured.manifest.scope.venueId
  });
  const runtime = Object.freeze({
    mode: 'tenant',
    manifest: configured.manifest,
    binding: Object.freeze({
      runtimeKey: row.runtime_key,
      manifestSha256: row.manifest_sha256,
      manifestRevision: Number(row.manifest_revision),
      companyId: row.company_id,
      venueId: row.venue_id,
      isolationPolicy: row.isolation_policy,
      status: row.status
    }),
    context,
    // The current artifact is still PIVNIK-specific. A valid binding proves only
    // isolation/config ownership; it is not publication or provisioning.
    startAllowed: false
  });
  verifiedRuntimeContexts.add(context);
  verifiedTenantRuntimes.add(runtime);
  return runtime;
}

export function requireSpaceverseTenantRuntime(runtime) {
  if (runtime?.mode !== 'tenant' || !verifiedTenantRuntimes.has(runtime)) {
    throw failure('SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED', 'SPACEVERSE tenant context is not verified.');
  }
  return runtime;
}

export function requireSpaceverseTenantContext(runtime) {
  const verified = requireSpaceverseTenantRuntime(runtime);
  if (!verifiedRuntimeContexts.has(verified.context)) {
    throw failure('SPACEVERSE_RUNTIME_CONTEXT_UNVERIFIED', 'SPACEVERSE tenant context is not verified.');
  }
  return verified.context;
}

export function assertSpaceverseRuntimeStartAllowed(runtime) {
  if (runtime?.mode === 'tenant' && runtime.startAllowed !== true) {
    throw failure('SPACEVERSE_RUNTIME_NOT_PROVISIONED', 'SPACEVERSE tenant runtime is not provisioned for startup.');
  }
  return runtime;
}

export async function guardSpaceverseRuntimeStartup(options) {
  return assertSpaceverseRuntimeStartAllowed(await resolveSpaceverseRuntime(options));
}
