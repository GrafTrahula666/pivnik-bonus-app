// @vitest-environment node
// CHAT 03 / 24: synthetic metadata authorization proof for the UNMOUNTED gate.
import crypto from 'node:crypto'
import {afterAll,afterEach,beforeAll,describe,expect,it} from 'vitest'
import {config} from '../config.js'
import {tenantCrmFixture} from './tenant-crm-fixture.js'
import {createTenantCrmContactOwnerGate} from '../tenant-crm-contact-owner-gate.js'

const token=(n:number)=>crypto.createHash('sha256').update('crm-manual-admin-'+n).digest('hex')
const requestKey='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const created={contact:{id:'98'},requestKey}
const admins={
  root:{id:'1',email:'root@fixture.invalid',displayName:'root',role:'SUPER_ADMIN' as const},
  owner:{id:'11',email:'owner@fixture.invalid',displayName:'owner',role:'VENUE_ADMIN' as const},
  trusted:{id:'12',email:'trusted@fixture.invalid',displayName:'trusted',role:'VENUE_ADMIN' as const},
  south:{id:'21',email:'south@fixture.invalid',displayName:'south',role:'VENUE_ADMIN' as const}
}

describe('unmounted manual CRM contact owner/session-grant admission',()=>{
  let fixture:Awaited<ReturnType<typeof tenantCrmFixture>>
  let calls=0,enabled=false
  const metadata=()=>({connect:async()=>{
    const db=fixture.metadata
    if(db.connect)return db.connect()
    return {query:db.query.bind(db),release(){}}
  }})
  const gate=()=>createTenantCrmContactOwnerGate({metadata:metadata(),enabled:()=>enabled})
  const draft=(i=0)=>fixture.manifests[i]!.source.draftId
  const writer=async({manifest,actorId}:{manifest:{scope:{companyId:string;venueId:string}};actorId:string})=>{
    calls++
    expect(actorId).toBe('11')
    expect(manifest.scope).toEqual(fixture.manifests[0]!.scope)
    return created
  }
  const audit=async()=>{
    const res=await fixture.metadata.query<{n:string}>(
      "SELECT COUNT(*)::text AS n FROM admin_audit_log WHERE action='crm.manual_contact_create_request'")
    return Number(res.rows[0]!.n)
  }
  beforeAll(async()=>{
    fixture=await tenantCrmFixture()
    config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=true
    for(const [id,n] of [[1,1],[11,11],[12,12],[21,21]] as const)
      await fixture.metadata.query(`INSERT INTO admin_sessions(token_hash,admin_id,expires_at)
        VALUES($1,$2,NOW()+INTERVAL '1 hour')`,[token(n),id])
  },90_000)
  afterEach(async()=>{
    enabled=false;calls=0
    config.enableWrites=config.enableOnboardingDrafts=config.enableOnboardingInvitations=true
    await fixture.metadata.query("UPDATE admin_accounts SET active=TRUE WHERE id IN (1,11,12,21)")
    await fixture.metadata.query("UPDATE admin_company_access SET access_kind='owner' WHERE admin_id=11")
    await fixture.metadata.query("UPDATE admin_onboarding_access SET role='manager',revoked_at=NULL WHERE admin_id=12")
    await fixture.metadata.query("UPDATE admin_sessions SET expires_at=NOW()+INTERVAL '1 hour'")
  })
  afterAll(async()=>{
    for(const db of fixture?.targets||[])await db.close()
    await fixture?.metadata.close()
  })

  it('is default-off, including when other onboarding flags are enabled',async()=>{
    await expect(gate()(admins.owner,token(11),draft(),requestKey,writer)).rejects.toMatchObject({
      statusCode:403,code:'TENANT_CRM_CONTACT_CREATE_DISABLED'})
    expect(calls).toBe(0)
  })
  it('requires active exact signed session and denies forged or expired sessions',async()=>{
    enabled=true
    await expect(gate()(admins.owner,token(21),draft(),requestKey,writer)).rejects.toMatchObject({statusCode:404})
    await fixture.metadata.query("UPDATE admin_sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE token_hash=$1",[token(11)])
    await expect(gate()(admins.owner,token(11),draft(),requestKey,writer)).rejects.toMatchObject({statusCode:404})
    expect(calls).toBe(0)
  })
  it('requires owner, not invited manager, other company or an altered principal',async()=>{
    enabled=true
    await expect(gate()(admins.trusted,token(12),draft(),requestKey,async()=>created))
      .rejects.toMatchObject({statusCode:404})
    await expect(gate()(admins.south,token(21),draft(),requestKey,async()=>created))
      .rejects.toMatchObject({statusCode:404})
    await expect(gate()({...admins.owner,role:'SUPER_ADMIN'},token(11),draft(),requestKey,async()=>created))
      .rejects.toMatchObject({statusCode:404})
    await fixture.metadata.query("UPDATE admin_company_access SET access_kind='trusted' WHERE admin_id=11")
    // The existing onboarding access guard rejects this revoked owner grant with 403
    // before the manual-contact gate's own 404 denial. Both are fail-closed.
    await expect(gate()(admins.owner,token(11),draft(),requestKey,writer)).rejects.toMatchObject({statusCode:403})
    expect(calls).toBe(0)
  })
  it('allows a current draft-scoped owner invitation, not a manager promotion by implication',async()=>{
    enabled=true
    await fixture.metadata.query("UPDATE admin_onboarding_access SET role='owner' WHERE admin_id=12")
    const before=await audit()
    await expect(gate()(admins.trusted,token(12),draft(),requestKey,async()=>created)).resolves.toEqual(created)
    expect(await audit()).toBe(before+1)
  })
  it('holds authorized source and records scoped Admin metadata audit on success',async()=>{
    enabled=true
    const before=await audit()
    await expect(gate()(admins.owner,token(11),draft(),requestKey,writer)).resolves.toEqual(created)
    expect(calls).toBe(1)
    expect(await audit()).toBe(before+1)
    const row=await fixture.metadata.query<{company_id:string;venue_id:string;admin_id:string;metadata:{identityLinking:boolean}}>(
      "SELECT company_id::text,venue_id::text,admin_id::text,metadata FROM admin_audit_log WHERE action='crm.manual_contact_create_request' ORDER BY id DESC LIMIT 1")
    expect(row.rows[0]).toMatchObject({
      company_id:fixture.manifests[0]!.scope.companyId,
      venue_id:fixture.manifests[0]!.scope.venueId,
      admin_id:'11',metadata:{identityLinking:false}
    })
  })
  it('writes one scoped metadata audit for two successful exact-key replays',async()=>{
    enabled=true
    const key='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const before=await audit()
    const result={...created,requestKey:key}
    const writer=async()=>result
    await expect(gate()(admins.owner,token(11),draft(),key,writer)).resolves.toEqual(result)
    await expect(gate()(admins.owner,token(11),draft(),key,writer)).resolves.toEqual(result)
    expect(await audit()).toBe(before+1)
    const existing=await fixture.metadata.query<{n:string}>(`SELECT COUNT(*)::text AS n FROM admin_audit_log
      WHERE admin_id=11 AND action='crm.manual_contact_create_request'
        AND metadata->>'requestKey'=$1`,[key])
    expect(existing.rows[0]?.n).toBe('1')
  })
  it('rejects conflicting audit evidence without inserting a second audit row',async()=>{
    enabled=true
    const key='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const before=await audit()
    await expect(gate()(admins.owner,token(11),draft(),key,
      async()=>({...created,requestKey:key}))).resolves.toMatchObject({contact:{id:'98'}})
    await expect(gate()(admins.owner,token(11),draft(),key,
      async()=>({contact:{id:'99'},requestKey:key}))).rejects.toMatchObject({
      statusCode:503,code:'TENANT_CRM_CONTACT_ACCESS_UNAVAILABLE'})
    expect(await audit()).toBe(before+1)
  })
  it('rolls back metadata audit when the tenant write callback fails',async()=>{
    enabled=true
    const before=await audit()
    await expect(gate()(admins.owner,token(11),draft(),requestKey,async()=>{
      throw new Error('synthetic target private credentials')
    })).rejects.toMatchObject({statusCode:503,code:'TENANT_CRM_CONTACT_ACCESS_UNAVAILABLE'})
    expect(await audit()).toBe(before)
  })
  it('rejects missing request-scope syntax before any callback',async()=>{
    enabled=true
    await expect(gate()(admins.owner,token(11),'not-a-draft',requestKey,writer)).rejects.toMatchObject({statusCode:400})
    await expect(gate()(admins.owner,'not-a-hash',draft(),requestKey,writer)).rejects.toMatchObject({statusCode:400})
    expect(calls).toBe(0)
  })
})
