// @vitest-environment node
// CHAT_06 #52: orchestration tests with a simulated license-guard boundary.
// Existing native PostgreSQL tests verify the actual guard. These tests are
// NOT real provider identity, real entitlement, or live cash evidence.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onboardingSecretBox } from '../onboarding-secrets.js'
import { readLicensedEvotorDocumentPage } from '../evotor-market-document-reader.js'
import type { EvotorReadProjection } from '../evotor-market-document-reader.js'
import { normalizeEvotorDocument } from '../../../pos/evotor-document.js'

const mockState = vi.hoisted(() => ({
  status:'ready', checks:0, credential:null as unknown, revokeOnSecond:false,
}))
vi.mock('../evotor-market-license-guard.js', () => ({
  withEvotorPaidLicenseGuard: async ({
    scope,actorId,sessionTokenHash,policy,signedEntitlement,signingKey,onAuthorized,
  }: {
    scope:{companyId:string;venueId:string;storeId:string;providerUserId:string}
    actorId:string; sessionTokenHash:string; policy:{approved:boolean}|null
    signedEntitlement:string; signingKey:Buffer
    onAuthorized:(client:{query:(sql:string,params:unknown[])=>Promise<unknown>})=>Promise<unknown>
  }) => {
    mockState.checks++
    if (mockState.status!=='ready' || scope.companyId!=='101'
      || scope.venueId!=='202' || scope.storeId!=='store-verified'
      || scope.providerUserId!=='provider-verified'
      || actorId!=='303' || sessionTokenHash!=='a'.repeat(64)
      || policy?.approved!==true || signedEntitlement!=='trusted-signed-license'
      || !Buffer.isBuffer(signingKey) || signingKey.length < 32) {
      throw Object.assign(new Error('No license'),{code:'EVOTOR_LICENSE_DENIED',statusCode:403})
    }
    return onAuthorized({
      query:async (sql:string, params:unknown[]) => {
        if (!sql.includes("b.state='ready'") || !sql.includes('b.token_revision=u.token_revision')
          || !sql.includes('b.company_id=$4::bigint')
          || JSON.stringify(params)!==JSON.stringify([
            'c0d01535-5193-4cc2-9bfb-be20e0679498','provider-verified','store-verified','101','202',
          ])) throw new Error('Unscoped credential query')
        return {rowCount:1,rows:[mockState.credential]}
      },
    })
  },
}))
const env: NodeJS.ProcessEnv = {
  ADMIN_ONBOARDING_SECRET_ACTIVE_KEY_ID:'test-key',
  ADMIN_ONBOARDING_SECRET_KEYRING:JSON.stringify({'test-key':Buffer.alloc(32,51).toString('base64')}),
}
const scope = {
  productId:'c0d01535-5193-4cc2-9bfb-be20e0679498',
  providerUserId:'provider-verified',
  subscriptionId:'f1d01535-5193-4cc2-9bfb-be20e0679498',
  companyId:'101',venueId:'202',storeId:'store-verified',
}
const doc = {
  id:'cloud-sale-1',store_id:scope.storeId,type:'SELL',close_date:'2026-11-01T08:03:04Z',
  customer_phone:'+0000000000', extras:{privateValue:'discard-me'},
  body:{
    result_sum:'12.34',
    positions:[{product_name:'Чай',quantity:'1.000',result_sum:'12.34'}],
    payments:[{payment:{type:'CASH',sum:'12.34'}}],
    pos_print_results:[{pos_print_result:{receipt_number:2}}],
  },
}
const response = (items:unknown[]=[doc],paging?:unknown) => new Response(JSON.stringify({items,...(paging!==undefined?{paging}:{})}), {
  status:200, headers:{'Content-Type':'application/vnd.evotor.v2+json'},
})
const defaultFetch = vi.fn(async () => response())
const database = {connect: vi.fn()}
const normalizeDocument = (raw:unknown,storeId:string):EvotorReadProjection|null =>
  normalizeEvotorDocument(raw as Parameters<typeof normalizeEvotorDocument>[0],storeId) as EvotorReadProjection|null
const call = (patch: Record<string, unknown> = {}) => readLicensedEvotorDocumentPage({
  database:database as never,scope,actorId:'303',sessionTokenHash:'a'.repeat(64),
  policy:{approved:true,unit:'venue',planIds:['approved-plan'],allowTrial:false,allowGrace:false,maxProofAgeMs:120000},
  signedEntitlement:'trusted-signed-license',signingKey:Buffer.alloc(32,44),
  sinceMs:1793510000000,untilMs:1793596400000,env,
  normalizeDocument,fetchImpl:defaultFetch as typeof fetch,...patch,
})

beforeEach(() => {
  mockState.status='ready';mockState.checks=0;mockState.revokeOnSecond=false
  defaultFetch.mockReset().mockImplementation(async () => response())
  const envelope=onboardingSecretBox(env).encrypt('synthetic-provider-only-token',
    `evotor-market-token-v1:${scope.productId}:${scope.providerUserId}`)
  mockState.credential={
    secret_key_id:envelope.keyId,secret_nonce:envelope.nonce,
    secret_ciphertext:envelope.ciphertext,secret_auth_tag:envelope.authTag,token_revision:'2',
  }
})

describe('CHAT_06 task 52: unmounted read-only, fail-closed licensed cloud page', () => {
  it('uses exact fixed cloud endpoint, GET, server credential and normalized contact-free data',async () => {
    const r=await call()
    expect(mockState.checks).toBe(2)
    expect(r.hasMore).toBe(false)
    expect(r.documents).toHaveLength(1)
    expect(r.documents[0]).toMatchObject({type:'SELL',amountCents:1234,receiptCount:1,storeId:scope.storeId})
    expect(JSON.stringify(r)).not.toMatch(/customer_phone|privateValue|discard-me|synthetic-provider-only-token/)
    const [url,init]=defaultFetch.mock.calls[0] as unknown as [URL,RequestInit]
    expect(url.origin).toBe('https://api.evotor.ru')
    expect(url.pathname).toBe('/stores/store-verified/documents')
    expect(url.searchParams.get('type')).toBe('SELL,PAYBACK')
    expect(url.searchParams.get('cursor')).toBeNull()
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string,string>).Authorization).toBe('Bearer synthetic-provider-only-token')
    expect(init.redirect).toBe('error')
  })
  it.each(['pending','hold','revoked','disconnected','unlicensed'])(
    'never fetches with a %s binding/license state',async status => {
      mockState.status=status
      await expect(call()).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
      expect(defaultFetch).not.toHaveBeenCalled()
    },
  )
  it('denies foreign tenant, venue, store, owner, session and missing policy before network',async () => {
    const changes = [
      {scope:{...scope,companyId:'999'}},{scope:{...scope,venueId:'999'}},
      {scope:{...scope,storeId:'foreign'}},{actorId:'999'},{sessionTokenHash:'f'.repeat(64)},
      {policy:null},{signedEntitlement:'caller-controlled'},
    ]
    for(const change of changes) await expect(call(change)).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    expect(defaultFetch).not.toHaveBeenCalled()
  })
  it('fails closed if provider owner/store/license is revoked mid-fetch; never returns old data',async () => {
    const fetchImpl = vi.fn(async () => {mockState.status='revoked';return response()})
    await expect(call({fetchImpl:fetchImpl as typeof fetch})).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
    expect(mockState.checks).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('fails closed on token rotation while fetching',async () => {
    const fetchImpl = vi.fn(async () => {mockState.status='disconnected';return response()})
    await expect(call({fetchImpl:fetchImpl as typeof fetch})).rejects.toMatchObject({code:'EVOTOR_LICENSE_DENIED'})
  })
  it('rejects foreign, malformed and unnormalizable provider documents',async () => {
    for (const bad of [
      {...doc,store_id:'foreign'}, {...doc,type:'UNKNOWN'},
      {...doc,body:{...doc.body,result_sum:'wrong'}},
    ]) {
      const fetchImpl=vi.fn(async () => response([bad]))
      await expect(call({fetchImpl:fetchImpl as typeof fetch})).rejects.toMatchObject({code:'EVOTOR_DOCUMENT_READ_UNAVAILABLE'})
    }
  })
  it('never mistakes a partial page for complete history, does not return a browser cursor',async () => {
    const fetchImpl=vi.fn(async () => response([doc],{next_cursor:'opaque:safe=cursor'}))
    const result=await call({fetchImpl:fetchImpl as typeof fetch})
    expect(result.hasMore).toBe(true)
    expect(JSON.stringify(result)).not.toContain('opaque:safe=cursor')
  })
  it('rejects invalid dates and ranges with no provider request',async () => {
    for(const patch of [{sinceMs:NaN},{sinceMs:-1},{untilMs:0},{untilMs:1793510000000},{untilMs:9999999999999}]) {
      await expect(call(patch)).rejects.toMatchObject({code:'EVOTOR_DOCUMENT_READ_DENIED'})
    }
    expect(defaultFetch).not.toHaveBeenCalled()
  })
  it('rejects ambiguous paging instead of silently declaring complete history',async () => {
    for (const paging of [
      {cursor:'alternate-continuation'},
      {next_cursor:null},
      {next_cursor:''},
      {next_cursor:'safe',previous_cursor:'unexpected'},
      {next_cursor:23},
    ]) {
      const fetchImpl = vi.fn(async () => response([doc],paging))
      await expect(call({fetchImpl:fetchImpl as typeof fetch}))
        .rejects.toMatchObject({code:'EVOTOR_DOCUMENT_READ_UNAVAILABLE'})
    }
  })
  it('keeps an absent fiscal print count unknown and an empty provider page empty',async () => {
    const raw = {...doc,body:{...doc.body,pos_print_results:[]}}
    const fetchImpl = vi.fn(async () => response([raw]))
    const result=await call({fetchImpl:fetchImpl as typeof fetch})
    expect(result.documents[0]?.receiptCount).toBeNull()
    expect(result.documents[0]?.amountCents).toBe(1234)
    const empty=vi.fn(async () => response([]))
    const none=await call({fetchImpl:empty as typeof fetch})
    expect(none.documents).toEqual([])
    expect(none.hasMore).toBe(false)
  })
  it('rejects redirects, bad status/headers, malformed envelope and unsafe paging',async () => {
    for(const fetchImpl of [
      vi.fn(async()=>new Response('no',{status:403})),
      vi.fn(async()=>new Response('{"items":[]}',{status:200,headers:{'Content-Type':'text/html'}})),
      vi.fn(async()=>new Response('null',{status:200,headers:{'Content-Type':'application/json'}})),
      vi.fn(async()=>response([doc],{next_cursor:24})),
    ]) await expect(call({fetchImpl:fetchImpl as typeof fetch})).rejects.toMatchObject({code:'EVOTOR_DOCUMENT_READ_UNAVAILABLE'})
  })
})
