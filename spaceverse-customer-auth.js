import { createSpaceverseCustomerProvisioner } from './customer-provisioning.js';
import { createSpaceverseCustomerWalletRepository } from './customer-wallet-repository.js';
import { signSession, verifySession } from './platform-core.js';
import {
  requireSpaceverseTenantRuntime,
  SpaceverseRuntimeError
} from './spaceverse-runtime-manifest.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANONICAL_BIGINT_PATTERN = /^[1-9]\d{0,18}$/;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;
const IDENTITY_FIELDS = Object.freeze([
  'provider',
  'providerUserId',
  'firstName',
  'lastName',
  'username',
  'photoUrl'
]);

export const SPACEVERSE_AUTH_BINDING_SQL = `SELECT TRUE AS verified
FROM spaceverse_runtime_binding
WHERE singleton=TRUE
  AND runtime_key=$1
  AND manifest_sha256=$2
  AND manifest_revision=$3
  AND company_id=$4
  AND venue_id=$5
  AND isolation_policy='dedicated_database'
  AND status='prepared'
LIMIT 1`;

export const SPACEVERSE_AUTH_IDENTITY_SQL = `SELECT
  customer.id::text AS user_id,
  customer.session_version::text AS session_version
FROM spaceverse_runtime_binding AS binding
JOIN spaceverse_customer_ownership AS ownership
  ON ownership.runtime_key=binding.runtime_key
 AND ownership.company_id=binding.company_id
 AND ownership.venue_id=binding.venue_id
JOIN users AS customer
  ON customer.id=ownership.user_id
JOIN user_identities AS identity
  ON identity.user_id=customer.id
WHERE binding.singleton=TRUE
  AND binding.runtime_key=$1
  AND binding.manifest_sha256=$2
  AND binding.manifest_revision=$3
  AND binding.company_id=$4
  AND binding.venue_id=$5
  AND binding.isolation_policy='dedicated_database'
  AND binding.status='prepared'
  AND identity.provider=$6
  AND identity.provider_user_id=$7
  AND customer.role='client'
  AND customer.deleted_at IS NULL
  AND customer.merged_into_user_id IS NULL
LIMIT 2`;

export const SPACEVERSE_AUTH_SESSION_SQL = `SELECT customer.session_version::text
FROM spaceverse_runtime_binding AS binding
JOIN spaceverse_customer_ownership AS ownership
  ON ownership.runtime_key=binding.runtime_key
 AND ownership.company_id=binding.company_id
 AND ownership.venue_id=binding.venue_id
JOIN users AS customer ON customer.id=ownership.user_id
JOIN user_identities AS identity ON identity.user_id=customer.id
WHERE binding.singleton=TRUE
  AND binding.runtime_key=$1
  AND binding.manifest_sha256=$2
  AND binding.manifest_revision=$3
  AND binding.company_id=$4
  AND binding.venue_id=$5
  AND binding.isolation_policy='dedicated_database'
  AND binding.status='prepared'
  AND customer.id=$6::bigint
  AND identity.provider=$7
  AND identity.provider_user_id=$8
  AND customer.session_version=$9::bigint
  AND customer.role='client'
  AND customer.deleted_at IS NULL
  AND customer.merged_into_user_id IS NULL`;

function failure(code, message, statusCode = 403) {
  return Object.assign(new SpaceverseRuntimeError(code, message), { statusCode });
}

function exactObject(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !fields.includes(key))) {
    throw failure(
      'SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN',
      'Область заведения определяется сервером.',
      400
    );
  }
  return value;
}

function safeText(value, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  }
  const normalized = value.trim();
  if (normalized.length > max
    || (required && !normalized)
    || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  }
  return normalized || null;
}

function canonicalId(value) {
  if (typeof value !== 'string'
    || !CANONICAL_BIGINT_PATTERN.test(value)
    || BigInt(value) > MAX_SIGNED_BIGINT) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  }
  return value;
}

function normalizePhotoUrl(value) {
  const normalized = safeText(value, 2048);
  if (!normalized) return null;
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректный адрес фото.', 400);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректный адрес фото.', 400);
  }
  return url.toString();
}

function normalizeIdentity(raw) {
  const value = exactObject(raw, IDENTITY_FIELDS);
  if (!['telegram', 'vk'].includes(value.provider)) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Платформа входа не поддерживается.', 400);
  }
  const username = safeText(value.username, 64);
  if (username && (/\s/u.test(username) || username.replace(/^@+/, '').length === 0)) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  }
  return Object.freeze({
    provider: value.provider,
    providerUserId: canonicalId(value.providerUserId),
    firstName: safeText(value.firstName, 80, true),
    lastName: safeText(value.lastName, 80),
    username,
    photoUrl: normalizePhotoUrl(value.photoUrl)
  });
}

function exactlyOneRow(result) {
  if (!result || !Array.isArray(result.rows)) return null;
  const rowCount = Number(result.rowCount ?? result.rows.length);
  return rowCount === 1 && result.rows.length === 1 ? result.rows[0] : null;
}

function translateProvisioningFailure(error) {
  switch (error?.code) {
    case 'SPACEVERSE_CUSTOMER_PROVISION_REPLAY_CONFLICT':
      return failure(
        'SPACEVERSE_AUTH_REPLAY_CONFLICT',
        'Этот запрос уже использован для другого входа.',
        409
      );
    case 'SPACEVERSE_CUSTOMER_PROVISION_REJECTED':
    case 'SPACEVERSE_CUSTOMER_PROVISION_SCOPE_MISMATCH':
      return failure(
        'SPACEVERSE_AUTH_BINDING_REJECTED',
        'База не привязана к этому заведению.'
      );
    default:
      return failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Не удалось завершить вход. Повторите тот же запрос.',
        503
      );
  }
}

/**
 * Tenant-local authentication boundary.
 *
 * Existing identities are accepted only through exact binding + ownership.
 * A missing identity delegates all writes to customer-provisioning.js, which
 * rechecks the binding and atomically creates the canonical customer, identity,
 * zero wallet, ownership and replay ledger. Auth never owns a second creation
 * path and never adopts an unowned historical Telegram/VK identity.
 */
export function createSpaceverseCustomerAuth({
  runtime,
  connect,
  query,
  verifyIdentity,
  sessionSecret,
  now = Date.now
} = {}) {
  const verifiedRuntime = requireSpaceverseTenantRuntime(runtime);
  if (typeof connect !== 'function'
    || typeof query !== 'function'
    || typeof verifyIdentity !== 'function') {
    throw new TypeError('Tenant auth requires connect, query and signed identity verification');
  }
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new TypeError('Tenant sessions require a secret of at least 32 characters');
  }

  const binding = verifiedRuntime.binding;
  const scope = Object.freeze([
    binding.runtimeKey,
    binding.manifestSha256,
    binding.manifestRevision,
    verifiedRuntime.context.tenantId,
    verifiedRuntime.context.locationId
  ]);
  const provisionCustomer = createSpaceverseCustomerProvisioner({
    runtime: verifiedRuntime,
    connect
  });
  const loadWallet = createSpaceverseCustomerWalletRepository({
    runtime: verifiedRuntime,
    query
  });

  async function assertLiveBinding() {
    let result;
    try {
      result = await query(SPACEVERSE_AUTH_BINDING_SQL, scope);
    } catch {
      throw failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Проверка заведения временно недоступна.',
        503
      );
    }
    const row = exactlyOneRow(result);
    if (!row || row.verified !== true) {
      throw failure(
        'SPACEVERSE_AUTH_BINDING_REJECTED',
        'База не привязана к этому заведению.'
      );
    }
  }

  async function loadOwnedIdentity(identity) {
    let result;
    try {
      result = await query(SPACEVERSE_AUTH_IDENTITY_SQL, [
        ...scope,
        identity.provider,
        identity.providerUserId
      ]);
    } catch {
      throw failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Проверка профиля временно недоступна.',
        503
      );
    }
    if (!result || !Array.isArray(result.rows)) {
      throw failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Проверка профиля вернула некорректный результат.',
        503
      );
    }
    if (result.rows.length === 0) return null;
    const row = exactlyOneRow(result);
    if (!row) {
      throw failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Проверка профиля вернула некорректный результат.',
        503
      );
    }
    return Object.freeze({
      userId: canonicalId(String(row.user_id)),
      sessionVersion: canonicalId(String(row.session_version))
    });
  }

  async function loadProfile(userId, missingCode = 'SPACEVERSE_AUTH_CUSTOMER_NOT_OWNED') {
    let profile;
    try {
      profile = await loadWallet({ userId });
    } catch (error) {
      if (error?.code === 'SPACEVERSE_CUSTOMER_WALLET_READ_REJECTED') {
        throw failure(
          'SPACEVERSE_AUTH_BINDING_REJECTED',
          'База не привязана к этому заведению.'
        );
      }
      throw failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Проверка кошелька временно недоступна.',
        503
      );
    }
    if (!profile) {
      throw failure(missingCode, 'Этот профиль не принадлежит данному заведению.', 401);
    }
    if (!profile.wallet) {
      throw failure(
        'SPACEVERSE_AUTH_WALLET_MISSING',
        'Кошелёк профиля не настроен.',
        503
      );
    }
    return profile;
  }

  async function authenticate(input) {
    const options = exactObject(input, ['requestKey', 'credentials']);
    if (typeof options.requestKey !== 'string' || !UUID_V4_PATTERN.test(options.requestKey)) {
      throw failure(
        'SPACEVERSE_AUTH_REQUEST_KEY_INVALID',
        'Повторите вход с новым идентификатором запроса.',
        400
      );
    }
    const requestKey = options.requestKey.toLowerCase();
    // Identity comes only from a server-side Telegram/VK signature verifier.
    const identity = normalizeIdentity(await verifyIdentity(options.credentials));

    await assertLiveBinding();
    let account = await loadOwnedIdentity(identity);
    if (!account) {
      let identityCollision = false;
      try {
        await provisionCustomer({ requestKey, customer: identity });
      } catch (error) {
        if (error?.code === 'SPACEVERSE_CUSTOMER_PROVISION_IDENTITY_CONFLICT') {
          // A concurrent create may have won. It is accepted only if a fresh,
          // exact ownership lookup now proves this identity belongs here.
          identityCollision = true;
        } else {
          throw translateProvisioningFailure(error);
        }
      }
      account = await loadOwnedIdentity(identity);
      if (!account) {
        if (identityCollision) {
          throw failure(
            'SPACEVERSE_AUTH_CUSTOMER_NOT_OWNED',
            'Этот профиль не принадлежит данному заведению.',
            401
          );
        }
        throw failure(
          'SPACEVERSE_AUTH_UNAVAILABLE',
          'Не удалось подтвердить созданный профиль. Повторите тот же запрос.',
          503
        );
      }
    }

    const profile = await loadProfile(account.userId);
    const token = signSession({
      uid: account.userId,
      sv: account.sessionVersion,
      platform: identity.provider,
      pid: identity.providerUserId,
      runtimeKey: binding.runtimeKey,
      manifestSha256: binding.manifestSha256,
      manifestRevision: binding.manifestRevision,
      companyId: scope[3],
      venueId: scope[4],
      exp: now() + 8 * 60 * 60 * 1000
    }, sessionSecret);
    return Object.freeze({ token, profile, runtimeStatus: 'not_provisioned' });
  }

  async function authorize(token) {
    const session = verifySession(token, sessionSecret, now());
    if (!session
      || session.runtimeKey !== scope[0]
      || session.manifestSha256 !== scope[1]
      || session.manifestRevision !== scope[2]
      || session.companyId !== scope[3]
      || session.venueId !== scope[4]
      || !['telegram', 'vk'].includes(session.platform)
      || typeof session.uid !== 'string'
      || typeof session.pid !== 'string'
      || typeof session.sv !== 'string'
      || !CANONICAL_BIGINT_PATTERN.test(session.uid)
      || !CANONICAL_BIGINT_PATTERN.test(session.pid)
      || !CANONICAL_BIGINT_PATTERN.test(session.sv)
      || BigInt(session.uid) > MAX_SIGNED_BIGINT
      || BigInt(session.pid) > MAX_SIGNED_BIGINT
      || BigInt(session.sv) > MAX_SIGNED_BIGINT) {
      throw failure(
        'SPACEVERSE_AUTH_SESSION_INVALID',
        'Войдите в приложение этого заведения.',
        401
      );
    }

    let result;
    try {
      result = await query(SPACEVERSE_AUTH_SESSION_SQL, [
        ...scope,
        session.uid,
        session.platform,
        session.pid,
        session.sv
      ]);
    } catch {
      throw failure(
        'SPACEVERSE_AUTH_UNAVAILABLE',
        'Проверка входа временно недоступна.',
        503
      );
    }
    if (!exactlyOneRow(result)) {
      throw failure(
        'SPACEVERSE_AUTH_SESSION_INVALID',
        'Сессия больше недоступна.',
        401
      );
    }
    return loadProfile(session.uid, 'SPACEVERSE_AUTH_SESSION_INVALID');
  }

  return Object.freeze({ authenticate, authorize });
}
