import crypto from 'node:crypto';
import { createSpaceverseCustomerWalletRepository } from './customer-wallet-repository.js';
import { signSession, verifySession } from './platform-core.js';
import { requireSpaceverseTenantRuntime, SpaceverseRuntimeError } from './spaceverse-runtime-manifest.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const idPattern = /^[1-9]\d{0,18}$/;
const identityFields = ['provider', 'providerUserId', 'firstName', 'lastName', 'username', 'photoUrl'];
export const SPACEVERSE_AUTH_BINDING_SQL = `SELECT TRUE AS verified
FROM spaceverse_runtime_binding
WHERE singleton=TRUE AND runtime_key=$1 AND manifest_sha256=$2
  AND manifest_revision=$3 AND company_id=$4 AND venue_id=$5
  AND isolation_policy='dedicated_database' AND status='prepared'
FOR SHARE`;

const identitySql = `SELECT customer.id::text AS user_id,customer.session_version::text,
  ownership.user_id::text AS owned_user_id,customer.role,customer.deleted_at,customer.merged_into_user_id
FROM user_identities AS identity JOIN users AS customer ON customer.id=identity.user_id
LEFT JOIN spaceverse_customer_ownership AS ownership
  ON ownership.user_id=customer.id AND ownership.runtime_key=$1
 AND ownership.company_id=$2 AND ownership.venue_id=$3
WHERE identity.provider=$4 AND identity.provider_user_id=$5
FOR UPDATE OF identity,customer`;

export const SPACEVERSE_AUTH_SESSION_SQL = `SELECT customer.session_version::text
FROM spaceverse_runtime_binding AS binding
JOIN spaceverse_customer_ownership AS ownership
  ON ownership.runtime_key=binding.runtime_key
 AND ownership.company_id=binding.company_id AND ownership.venue_id=binding.venue_id
JOIN users AS customer ON customer.id=ownership.user_id
JOIN user_identities AS identity ON identity.user_id=customer.id
WHERE binding.singleton=TRUE AND binding.runtime_key=$1 AND binding.manifest_sha256=$2
  AND binding.manifest_revision=$3 AND binding.company_id=$4 AND binding.venue_id=$5
  AND binding.isolation_policy='dedicated_database' AND binding.status='prepared'
  AND customer.id=$6::bigint AND identity.provider=$7 AND identity.provider_user_id=$8
  AND customer.session_version=$9::bigint AND customer.role='client'
  AND customer.deleted_at IS NULL AND customer.merged_into_user_id IS NULL`;

function failure(code, message, statusCode = 403) {
  return Object.assign(new SpaceverseRuntimeError(code, message), { statusCode });
}
function exact(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key))) {
    throw failure('SPACEVERSE_RUNTIME_REQUEST_SCOPE_FORBIDDEN', 'Область заведения определяется сервером.', 400);
  }
  return value;
}
function text(value, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  const result = value.trim();
  if (result.length > max || (required && !result) || /[\x00-\x1f\x7f]/.test(result)) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  }
  return result || null;
}
function canonicalId(value) {
  if (typeof value !== 'string' || !idPattern.test(value) || BigInt(value) > 9223372036854775807n) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректные данные входа.', 400);
  }
  return value;
}
function normalizeIdentity(raw) {
  const value = exact(raw, identityFields);
  if (!['telegram', 'vk'].includes(value.provider)) {
    throw failure('SPACEVERSE_AUTH_INVALID', 'Платформа входа не поддерживается.', 400);
  }
  const photoUrl = text(value.photoUrl, 2048);
  if (photoUrl) {
    let url;
    try { url = new URL(photoUrl); } catch { throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректный адрес фото.', 400); }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw failure('SPACEVERSE_AUTH_INVALID', 'Некорректный адрес фото.', 400);
    }
  }
  return Object.freeze({ provider: value.provider, providerUserId: canonicalId(value.providerUserId),
    firstName: text(value.firstName, 80, true), lastName: text(value.lastName, 80),
    username: text(value.username, 100), photoUrl });
}

/** New customers only; existing identities must already have exact ownership.
 * connect must return a real transaction-bound client; never a legacy fallback.
 */
export function createSpaceverseCustomerAuth({ runtime, connect, query, verifyIdentity, sessionSecret, now = Date.now } = {}) {
  const verifiedRuntime = requireSpaceverseTenantRuntime(runtime);
  if (typeof connect !== 'function' || typeof query !== 'function' || typeof verifyIdentity !== 'function') {
    throw new TypeError('Tenant auth requires connect, query and signed identity verification');
  }
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new TypeError('Tenant sessions require a secret of at least 32 characters');
  }
  const binding = verifiedRuntime.binding;
  const scope = [binding.runtimeKey, binding.manifestSha256, binding.manifestRevision,
    verifiedRuntime.context.tenantId, verifiedRuntime.context.locationId];
  const loadWallet = createSpaceverseCustomerWalletRepository({ runtime: verifiedRuntime, query });

  async function authenticate(input) {
    const options = exact(input, ['requestKey', 'credentials']);
    if (typeof options.requestKey !== 'string' || !uuidPattern.test(options.requestKey)) {
      throw failure('SPACEVERSE_AUTH_REQUEST_KEY_INVALID', 'Повторите вход с новым идентификатором запроса.', 400);
    }
    const requestKey = options.requestKey.toLowerCase();
    // Identity comes only from the server-side signature verifier, never a userId/role/scope body field.
    const identity = normalizeIdentity(await verifyIdentity(options.credentials));
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    let client;
    try { client = await connect(); }
    catch { throw failure('SPACEVERSE_AUTH_UNAVAILABLE', 'Вход временно недоступен. Повторите запрос.', 503); }
    let userId, sessionVersion;
    try {
      await client.query('BEGIN');
      const checked = await client.query(SPACEVERSE_AUTH_BINDING_SQL, scope);
      if (checked?.rows?.length !== 1 || checked.rows[0].verified !== true) {
        throw failure('SPACEVERSE_AUTH_BINDING_REJECTED', 'База не привязана к этому заведению.');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sv-auth-request:${binding.runtimeKey}:${requestKey}`]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sv-auth-identity:${binding.runtimeKey}:${identity.provider}:${identity.providerUserId}`]);
      const receipt = (await client.query(`SELECT fingerprint,user_id::text FROM spaceverse_customer_auth_requests
        WHERE runtime_key=$1 AND request_key=$2::uuid`, [binding.runtimeKey, requestKey])).rows[0];
      if (receipt && receipt.fingerprint !== fingerprint) {
        throw failure('SPACEVERSE_AUTH_REPLAY_CONFLICT', 'Этот запрос уже использован для другого входа.', 409);
      }
      const existing = (await client.query(identitySql, [scope[0], scope[3], scope[4], identity.provider, identity.providerUserId])).rows[0];
      if (existing) {
        if (!existing.owned_user_id || existing.role !== 'client' || existing.deleted_at || existing.merged_into_user_id
          || (receipt && receipt.user_id !== existing.user_id)) {
          throw failure('SPACEVERSE_AUTH_CUSTOMER_NOT_OWNED', 'Этот профиль не принадлежит данному заведению.', 401);
        }
        userId = existing.user_id;
        sessionVersion = existing.session_version;
      } else {
        if (receipt) throw failure('SPACEVERSE_AUTH_CUSTOMER_NOT_OWNED', 'Профиль входа больше недоступен.', 401);
        const user = (await client.query(`INSERT INTO users(first_name,last_name,username,photo_url,role)
          VALUES($1,$2,$3,$4,'client') RETURNING id::text,session_version::text`,
        [identity.firstName, identity.lastName, identity.username, identity.photoUrl])).rows[0];
        userId = user.id;
        sessionVersion = user.session_version;
        await client.query(`INSERT INTO user_identities(user_id,provider,provider_user_id,provider_username)
          VALUES($1::bigint,$2,$3,$4)`, [userId, identity.provider, identity.providerUserId, identity.username]);
        await client.query('INSERT INTO wallets(user_id,balance) VALUES($1::bigint,0)', [userId]);
        await client.query(`INSERT INTO spaceverse_customer_ownership(user_id,runtime_key,company_id,venue_id)
          VALUES($1::bigint,$2,$3,$4)`, [userId, binding.runtimeKey, scope[3], scope[4]]);
      }
      // A present zero balance is data; a missing wallet is never converted to zero.
      const wallet = await client.query('SELECT user_id FROM wallets WHERE user_id=$1::bigint', [userId]);
      if (wallet.rows.length !== 1) throw failure('SPACEVERSE_AUTH_WALLET_MISSING', 'Кошелёк профиля не настроен.', 503);
      if (!receipt) await client.query(`INSERT INTO spaceverse_customer_auth_requests
        (runtime_key,request_key,company_id,venue_id,provider,provider_user_id,fingerprint,user_id)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7,$8::bigint)`,
      [binding.runtimeKey, requestKey, scope[3], scope[4], identity.provider, identity.providerUserId, fingerprint, userId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error instanceof SpaceverseRuntimeError) throw error;
      throw failure('SPACEVERSE_AUTH_UNAVAILABLE', 'Не удалось завершить вход. Повторите тот же запрос.', 503);
    } finally { client.release(); }
    const profile = await loadWallet({ userId });
    if (!profile?.wallet) throw failure('SPACEVERSE_AUTH_WALLET_MISSING', 'Кошелёк профиля не настроен.', 503);
    const token = signSession({ uid: userId, sv: sessionVersion, platform: identity.provider, pid: identity.providerUserId,
      runtimeKey: binding.runtimeKey, manifestSha256: binding.manifestSha256, manifestRevision: binding.manifestRevision,
      companyId: scope[3], venueId: scope[4], exp: now() + 8 * 60 * 60 * 1000 }, sessionSecret);
    return Object.freeze({ token, profile, runtimeStatus: 'not_provisioned' });
  }

  async function authorize(token) {
    const session = verifySession(token, sessionSecret, now());
    if (!session || session.runtimeKey !== scope[0] || session.manifestSha256 !== scope[1]
      || session.manifestRevision !== scope[2] || session.companyId !== scope[3] || session.venueId !== scope[4]
      || !['telegram', 'vk'].includes(session.platform) || typeof session.uid !== 'string'
      || !idPattern.test(session.uid) || typeof session.pid !== 'string' || !idPattern.test(session.pid)
      || typeof session.sv !== 'string' || !idPattern.test(session.sv)
      || BigInt(session.uid) > 9223372036854775807n || BigInt(session.pid) > 9223372036854775807n
      || BigInt(session.sv) > 9223372036854775807n) {
      throw failure('SPACEVERSE_AUTH_SESSION_INVALID', 'Войдите в приложение этого заведения.', 401);
    }
    let result;
    try { result = await query(SPACEVERSE_AUTH_SESSION_SQL, [...scope, session.uid, session.platform, session.pid, session.sv]); }
    catch { throw failure('SPACEVERSE_AUTH_UNAVAILABLE', 'Проверка входа временно недоступна.', 503); }
    if (result?.rows?.length !== 1) throw failure('SPACEVERSE_AUTH_SESSION_INVALID', 'Сессия больше недоступна.', 401);
    const profile = await loadWallet({ userId: session.uid });
    if (!profile?.wallet) throw failure('SPACEVERSE_AUTH_WALLET_MISSING', 'Кошелёк профиля не настроен.', 503);
    return profile;
  }
  return Object.freeze({ authenticate, authorize });
}
