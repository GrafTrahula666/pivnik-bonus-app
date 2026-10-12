import crypto from 'node:crypto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNTIME_KEY_PATTERN = /^sv-[0-9a-f]{32}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const THEMES = new Set(['premium-dark', 'dark', 'light']);
const APP_FIELDS = Object.freeze([
  'displayName', 'theme', 'primaryColor', 'secondaryColor', 'shopEnabled', 'loyaltyEnabled'
]);

export const SPACEVERSE_RUNTIME_BINDING_SQL = `SELECT
  runtime_key,manifest_sha256,manifest_revision,isolation_policy,status
FROM spaceverse_runtime_binding
WHERE singleton=TRUE AND runtime_key=$1
LIMIT 1`;

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

function manifestCore({ draftId, runtimeKey, revision, config }) {
  const normalizedDraftId = safeText(draftId, { max: 36, pattern: UUID_PATTERN });
  const normalizedRuntimeKey = safeText(runtimeKey, { max: 35, pattern: RUNTIME_KEY_PATTERN });
  if (!Number.isSafeInteger(revision) || revision < 1 || revision > 2_147_483_647) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  return {
    schemaVersion: 1,
    runtimeKey: normalizedRuntimeKey,
    source: { kind: 'onboarding', draftId: normalizedDraftId.toLowerCase(), revision },
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
  return Object.freeze({ ...core, manifestSha256: digest(core) });
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
    'schemaVersion', 'runtimeKey', 'source', 'application', 'isolation', 'release', 'manifestSha256'
  ]);
  if (value.schemaVersion !== 1) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_INVALID', 'SPACEVERSE runtime manifest is invalid.');
  }
  const source = exactRecord(value.source, ['kind', 'draftId', 'revision']);
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
    revision: source.revision,
    config: Object.fromEntries(APP_FIELDS.map((field) => [field, application[field]]))
  });
  if (value.manifestSha256 !== manifest.manifestSha256) {
    throw failure('SPACEVERSE_RUNTIME_MANIFEST_DIGEST_MISMATCH', 'SPACEVERSE runtime manifest checksum does not match.');
  }
  return manifest;
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
    return Object.freeze({ mode: configured.mode, manifest: null, binding: null, startAllowed: true });
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
    || Number(row.manifest_revision) !== configured.manifest.source.revision
    || row.isolation_policy !== 'dedicated_database'
    || row.status !== 'prepared') {
    throw failure('SPACEVERSE_RUNTIME_BINDING_MISMATCH', 'SPACEVERSE runtime database is not bound to this manifest.');
  }
  return Object.freeze({
    mode: 'tenant',
    manifest: configured.manifest,
    binding: Object.freeze({
      runtimeKey: row.runtime_key,
      manifestSha256: row.manifest_sha256,
      manifestRevision: Number(row.manifest_revision),
      isolationPolicy: row.isolation_policy,
      status: row.status
    }),
    // The current artifact is still PIVNIK-specific. A valid binding proves only
    // isolation/config ownership; it is not publication or provisioning.
    startAllowed: false
  });
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
