// @vitest-environment node
import {describe,expect,it} from 'vitest'
import {tenantCrmReadiness} from '../tenant-crm-readiness.js'
import type {OnboardingPosProxyView} from '../onboarding-pos-proxy.js'
const now=Date.parse('2026-10-18T12:00:00.000Z')
const fresh=():OnboardingPosProxyView=>({draftId:'11111111-1111-4111-8111-111111111111',provider:'evotor',transport:'proxy_v2',
  revision:1,status:'active',code:'confirmed',nextAction:'Synthetic provider advice',storeId:'fixture-store',terminalId:'fixture-terminal',
  credential:{present:true,masked:'••••••••'},checkedAt:new Date(now-1000).toISOString(),lastDeviceActivityAt:new Date(now-2000).toISOString(),
  report:{state:'available',empty:true,netCents:'0',receiptCount:0,period:{from:'2026-10-18T00:00:00.000Z',until:'2026-10-19T00:00:00.000Z'}},
  runtimeStatus:'not_provisioned',published:false})
describe('CRM readiness cannot substitute a successful customer read for activation or subscription',()=>{
  it('treats an empty verified customer database as available while keeping the CRM pending',()=>{
    const result=tenantCrmReadiness('0',null,now)
    expect(result).toMatchObject({status:'pending',activationAllowed:false,crmStatus:'not_provisioned',guestApplicationRequired:false})
    expect(result.checks[0]).toMatchObject({status:'active',dataState:'empty',customerCount:'0'})
    expect(result.checks[1]).toMatchObject({status:'not_configured',code:'provider_verifier_disabled'})
    expect(result.checks[2]).toMatchObject({status:'not_configured',code:'market_contract_not_configured'})
    expect(result.checks[3]).toMatchObject({status:'pending'})
  })
  it('accepts a fresh zero provider report without treating it as absent, but does not activate CRM',()=>{
    const result=tenantCrmReadiness('25',fresh(),now)
    expect(result.checks[1]).toMatchObject({status:'active',code:'confirmed',evidence:'last_saved_verification'})
    expect(result).toMatchObject({status:'pending',activationAllowed:false,crmStatus:'not_provisioned'})
  })
  it.each(['checkedAt','lastDeviceActivityAt'] as const)('rejects stale, future and malformed %s',field=>{
    for(const timestamp of [new Date(now-300001).toISOString(),new Date(now+5001).toISOString(),'invalid',null]){
      const provider=fresh();provider[field]=timestamp
      const result=tenantCrmReadiness('25',provider,now)
      expect(result.status).toBe('degraded');expect(result.checks[1]).toMatchObject({status:'degraded',code:'provider_evidence_stale'})
      expect(result.activationAllowed).toBe(false)
    }
  })
  it('does not accept an unavailable report or an unconfirmed code as provider success',()=>{
    for(const change of ['state','count','period','code']){
      const provider=fresh()
      if(change==='state')provider.report.state='unavailable'
      if(change==='count')provider.report.receiptCount=null
      if(change==='period')provider.report.period=null
      if(change==='code')provider.code='terminal_event_missing'
      expect(tenantCrmReadiness('0',provider,now).checks[1]?.status).toBe('degraded')
    }
  })
  it.each(['pending','not_configured','verifying','degraded','suspended','failed'])('retains an unsuccessful provider state: %s',status=>{
    const provider=fresh();provider.status=status
    const result=tenantCrmReadiness('1',provider,now)
    expect(result.checks[1]?.status).toBe(status);expect(result.activationAllowed).toBe(false)
  })
  it('fails closed on unknown provider state and does not return stored report or credential data',()=>{
    const provider=fresh();provider.status='invented'
    const result=tenantCrmReadiness('1',provider,now)
    expect(result.status).toBe('failed');expect(result.checks[1]?.code).toBe('provider_evidence_invalid')
    expect(JSON.stringify(result)).not.toMatch(/fixture-store|fixture-terminal|credential|netCents|receiptCount/)
  })
})
