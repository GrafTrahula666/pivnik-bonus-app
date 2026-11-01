/**
 * CHAT_06 / task 52. UNMOUNTED, read-only, ONE PAGE ONLY.
 * No route, no imports into production entrypoints, no license issuer.
 * Production migration 024 has NO 'ready' binding, so real access fails closed.
 *
 * The auth actor/session/scope, approved policy, signed entitlement and
 * normalizeDocument callback MUST be server-owned, never accepted from HTTP.
 * The existing native-PG paid-license guard supplies the canonical tenant,
 * session, install, binding, token revision and paid-license row locks.
 */
import type { Pool, PoolClient } from 'pg'
import { withEvotorPaidLicenseGuard } from './evotor-market-license-guard.js'
import type { EvotorApprovedLicensePolicy, EvotorLicenseScope } from './evotor-market-license-policy.js'
import { onboardingSecretBox } from './onboarding-secrets.js'

export class EvotorDocumentReadError extends Error {
  readonly code: 'EVOTOR_DOCUMENT_READ_DENIED' | 'EVOTOR_DOCUMENT_READ_UNAVAILABLE'
  readonly statusCode: 403 | 503
  constructor(kind: 'DENIED' | 'UNAVAILABLE') {
    super(kind === 'DENIED' ? 'Нет подтверждённого доступа к документам Эвотора.' : 'Документы Эвотора временно недоступны.')
    this.code = kind === 'DENIED' ? 'EVOTOR_DOCUMENT_READ_DENIED' : 'EVOTOR_DOCUMENT_READ_UNAVAILABLE'
    this.statusCode = kind === 'DENIED' ? 403 : 503
  }
}
const denied = () => new EvotorDocumentReadError('DENIED')
const unavailable = () => new EvotorDocumentReadError('UNAVAILABLE')
const storePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const safeToken = /^[\x21-\x7e]{1,4096}$/
const positiveCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

export interface EvotorReadProjection {
  readonly source: 'evotor'
  readonly storeId: string
  readonly documentId: string
  readonly type: 'SELL' | 'PAYBACK'
  readonly closedAt: string
  readonly amountCents: number
  readonly receiptCount: number | null
  readonly baseDocumentId: string | null
  readonly positions: readonly {
    productId: string | null; name: string; measure: string; quantityMillis: number; amountCents: number
  }[]
  readonly payments: readonly { type: string; method: string; amountCents: number }[]
}

type SecretRow = {
  secret_key_id: string; secret_nonce: Buffer; secret_ciphertext: Buffer
  secret_auth_tag: Buffer; token_revision: string
}
const maxBodyBytes = 1_048_576
const timeoutMs = 15_000

/** Reuse the existing Evotor inbox AAD; never accept tokens from an API caller. */
async function credentialInsideLicense(client: PoolClient, scope: EvotorLicenseScope, env: NodeJS.ProcessEnv): Promise<string> {
  const result = await client.query<SecretRow>([
    'SELECT u.secret_key_id,u.secret_nonce,u.secret_ciphertext,u.secret_auth_tag,',
    'u.token_revision::text',
    'FROM admin_evotor_market_users u JOIN admin_evotor_store_bindings b',
    'ON b.product_id=u.product_id AND b.provider_user_id=u.user_id',
    'WHERE u.product_id=$1::uuid AND u.user_id=$2 AND b.store_id=$3',
    'AND b.company_id=$4::bigint AND b.venue_id=$5::bigint',
    "AND b.state='ready' AND b.token_revision=u.token_revision",
    "AND u.installation_state='installed' AND u.reconciliation_required=FALSE",
    'AND u.secret_ciphertext IS NOT NULL',
  ].join(' '), [scope.productId,scope.providerUserId,scope.storeId,scope.companyId,scope.venueId])
  if (result.rowCount !== 1) throw denied()
  const row = result.rows[0]!
  const token = onboardingSecretBox(env).decrypt({
    keyId: row.secret_key_id, nonce: row.secret_nonce,
    ciphertext: row.secret_ciphertext, authTag: row.secret_auth_tag,
  }, `evotor-market-token-v1:${scope.productId}:${scope.providerUserId}`)
  if (!safeToken.test(token)) throw unavailable()
  return token
}

function validateProjection(doc: EvotorReadProjection | null, raw: Record<string, unknown>, storeId: string): EvotorReadProjection {
  if (!doc || doc.source !== 'evotor' || doc.storeId !== storeId
    || doc.documentId !== raw.id || doc.type !== raw.type
    || typeof doc.documentId !== 'string' || !doc.documentId || doc.documentId.length > 200
    || !['SELL','PAYBACK'].includes(doc.type)
    || typeof doc.closedAt !== 'string' || !Number.isFinite(Date.parse(doc.closedAt))
    || !positiveCents(doc.amountCents)
    || (doc.receiptCount !== null && (!Number.isSafeInteger(doc.receiptCount) || doc.receiptCount < 1))
    || (doc.baseDocumentId !== null && (typeof doc.baseDocumentId !== 'string' || doc.baseDocumentId.length > 200))
    || !Array.isArray(doc.positions) || doc.positions.length > 1000
    || !Array.isArray(doc.payments) || doc.payments.length > 1000) throw unavailable()
  const positions = doc.positions.map(p => {
    if ((p.productId !== null && typeof p.productId !== 'string')
      || typeof p.name !== 'string' || typeof p.measure !== 'string'
      || p.name.length > 500 || p.measure.length > 80
      || !positiveCents(p.quantityMillis) || !positiveCents(p.amountCents)) throw unavailable()
    return Object.freeze({productId:p.productId,name:p.name,measure:p.measure,quantityMillis:p.quantityMillis,amountCents:p.amountCents})
  })
  const payments = doc.payments.map(p => {
    if (typeof p.type !== 'string' || typeof p.method !== 'string'
      || p.type.length > 80 || p.method.length > 80 || !positiveCents(p.amountCents)) throw unavailable()
    return Object.freeze({type:p.type,method:p.method,amountCents:p.amountCents})
  })
  // Explicit projection only: no phone, name, extras, raw token or unverified identity.
  return Object.freeze({
    source:'evotor',storeId,documentId:doc.documentId,type:doc.type,closedAt:doc.closedAt,
    amountCents:doc.amountCents,receiptCount:doc.receiptCount,baseDocumentId:doc.baseDocumentId,
    positions:Object.freeze(positions),payments:Object.freeze(payments),
  })
}

async function oneCloudPage({
  storeId, token, sinceMs, untilMs, fetchImpl,
}: {
  storeId:string; token:string; sinceMs:number; untilMs:number; fetchImpl:typeof fetch
}): Promise<{ items:unknown[]; hasMore:boolean }> {
  const url = new URL(`https://api.evotor.ru/stores/${encodeURIComponent(storeId)}/documents`)
  url.searchParams.set('type', 'SELL,PAYBACK')
  url.searchParams.set('since', String(sinceMs))
  url.searchParams.set('until', String(untilMs))
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_,reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()) }, timeoutMs)
  })
  let response: Response | undefined
  async function work(): Promise<{items:unknown[];hasMore:boolean}> {
    response = await fetchImpl(url, {
      method:'GET',redirect:'error',cache:'no-store',signal:controller.signal,
      headers:{
        Authorization:`Bearer ${token}`,
        Accept:'application/vnd.evotor.v2+json',
        'Content-Type':'application/vnd.evotor.v2+json',
      },
    })
    if (controller.signal.aborted || response.redirected
      || (response.url && response.url !== url.href) || response.status !== 200
      || !/^(application\/json|application\/vnd\.evotor\.v2\+json)(?:\s*;|$)/i.test(response.headers.get('content-type')||'')) throw unavailable()
    const len = response.headers.get('content-length')
    if (len !== null && (!/^\d+$/.test(len) || Number(len) > maxBodyBytes)) throw unavailable()
    if (!response.body) throw unavailable()
    const reader = response.body.getReader()
    let bytes = 0
    const chunks: Uint8Array[] = []
    try {
      for (;;) {
        if (controller.signal.aborted) throw unavailable()
        const chunk = await reader.read()
        if (controller.signal.aborted) throw unavailable()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > maxBodyBytes) throw unavailable()
        chunks.push(chunk.value)
      }
    } finally {
      void reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    if (len !== null && bytes !== Number(len)) throw unavailable()
    let raw: unknown
    try { raw = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) }
    catch { throw unavailable() }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable()
    const page = raw as Record<string,unknown>
    if (!Array.isArray(page.items) || page.items.length > 1000
      || (page.paging !== undefined && (!page.paging || typeof page.paging !== 'object' || Array.isArray(page.paging)))) throw unavailable()
    // Unknown paging fields are not proof of end-of-history. A present
    // continuation must be a valid nonempty opaque cursor, never null.
    const paging = page.paging as Record<string,unknown> | undefined
    if (paging && Object.keys(paging).some(key => key !== 'next_cursor')) throw unavailable()
    const hasMore = Boolean(paging && Object.hasOwn(paging, 'next_cursor'))
    const next = paging?.next_cursor
    if (hasMore && (typeof next !== 'string' || next.length < 1 || next.length > 4096
      || Array.from(next).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) throw unavailable()
    return {items:page.items,hasMore}
  }
  try { return await Promise.race([work(),deadline]) }
  catch { throw unavailable() }
  finally {
    if (timer) clearTimeout(timer)
    controller.abort()
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => undefined)
  }
}

/**
 * Denies by default until independently verified store/license policy is active.
 * Only a server-side normalized projection leaves this method. hasMore means
 * THIS PAGE is incomplete; NEVER claim historical completeness from this.
 * Pagination and resumable cursor discipline are separate task 55.
 */
export async function readLicensedEvotorDocumentPage({
  database, scope, actorId, sessionTokenHash, policy, signedEntitlement,
  signingKey, sinceMs, untilMs, normalizeDocument, env = process.env, fetchImpl = fetch,
}: {
  database: Pick<Pool,'connect'>
  scope: EvotorLicenseScope
  actorId: string
  sessionTokenHash: string
  policy: EvotorApprovedLicensePolicy | null
  signedEntitlement: string
  signingKey: Buffer
  sinceMs: number
  untilMs: number
  normalizeDocument: (raw:unknown, storeId:string) => EvotorReadProjection | null
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}): Promise<Readonly<{ documents:readonly EvotorReadProjection[]; hasMore:boolean }>> {
  if (!scope || !storePattern.test(scope.storeId)
    || typeof normalizeDocument !== 'function'
    || !Number.isSafeInteger(sinceMs) || !Number.isSafeInteger(untilMs)
    || sinceMs < 0 || untilMs <= sinceMs || untilMs - sinceMs > 366*86_400_000) throw denied()
  const guard = <T>(onAuthorized: (client: PoolClient) => Promise<T>) =>
    withEvotorPaidLicenseGuard({
      database,scope,actorId,sessionTokenHash,policy,signedEntitlement,signingKey,onAuthorized,
    })
  // The token is decrypted INSIDE a real DB-grant/license/binding transaction.
  // Network never holds a DB transaction open, then a fresh guard checks
  // that revocation, scope and token revision did not change mid-fetch.
  const token = await guard(client => credentialInsideLicense(client,scope,env))
  let page: {items:unknown[];hasMore:boolean}
  try { page = await oneCloudPage({storeId:scope.storeId,token,sinceMs,untilMs,fetchImpl}) }
  catch { throw unavailable() }
  let documents: EvotorReadProjection[]
  try {
    documents = page.items.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable()
      const obj = raw as Record<string,unknown>
      if (obj.store_id !== scope.storeId || !['SELL','PAYBACK'].includes(String(obj.type))) throw unavailable()
      return validateProjection(normalizeDocument(raw,scope.storeId),obj,scope.storeId)
    })
  } catch { throw unavailable() }
  // MUST reauthorize after the remote read: a revoked owner/venue/store/license
  // cannot receive a stale response fetched before revocation was committed.
  await guard(async () => true)
  return Object.freeze({documents:Object.freeze(documents),hasMore:page.hasMore})
}
