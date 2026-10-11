import { describe,expect,it } from 'vitest'
import { buildVenueScopeQuery,parsePositiveId,trustedDirectorCanWrite } from '../tenant.js'
import type { AdminPrincipal } from '../types.js'

const venueAdmin:AdminPrincipal={id:'11',email:'a@test.local',displayName:'A',role:'VENUE_ADMIN'}
const superAdmin:AdminPrincipal={id:'1',email:'root@test.local',displayName:'Root',role:'SUPER_ADMIN'}

describe('tenant scope query construction',()=>{
  it('always constrains Venue Admin by authenticated admin_company_access',()=>{
    const statement=buildVenueScopeQuery(venueAdmin,'101')
    expect(statement.params).toEqual(['101','11'])
    expect(statement.text).toContain('aca.company_id = v.company_id')
    expect(statement.text).toContain('aca.admin_id = $2::bigint')
  })
  it('does not accept caller company_id/body/query into authorization',()=>{
    const statement=buildVenueScopeQuery(venueAdmin,'101')
    expect(statement.params).toEqual(['101','11'])
    expect(statement.text).not.toContain('request.body')
    expect(statement.text).not.toContain('searchParams')
  })
  it('allows SUPER ADMIN venue lookup without company access join',()=>{
    const statement=buildVenueScopeQuery(superAdmin,'202')
    expect(statement.params).toEqual(['202'])
    expect(statement.text).not.toContain('aca.admin_id = $2')
  })
  it.each(['../202','101 OR 1=1','0','-1','1?company_id=999'])('rejects forged venue id %s',(value:string)=>{
    expect(()=>parsePositiveId(value,'venue_id')).toThrow()
  })
})

describe('trusted director permission allowlist',()=>{
  it('allows only marketing campaign publication and communication',()=>{
    expect(trustedDirectorCanWrite('POST','broadcast','','')).toBe(true)
    expect(trustedDirectorCanWrite('POST','app','promotions','')).toBe(true)
    expect(trustedDirectorCanWrite('PUT','app','promotions','123')).toBe(true)
    expect(trustedDirectorCanWrite('PUT','promotions','manage','')).toBe(true)
  })
  it.each([
    ['DELETE','app','promotions','123'],['PUT','app','design',''],
    ['PUT','app','loyalty',''],['PUT','app','wheel',''],
    ['PUT','app','rewards','achievements'],['POST','clients','123','bonus-adjustments'],
    ['POST','clients','123','entitlements'],['POST','clients','123','frames'],
    ['PUT','clients','123','cashback'],['PUT','features','manage',''],
    ['PUT','branding','manage',''],['PUT','shop','manage',''],
    ['POST','broadcast','preview',''],['PATCH','promotions','manage',''],
  ])('blocks non-marketing mutation %s %s %s %s',(method,resource,child,grandchild)=>{
    expect(trustedDirectorCanWrite(method,resource,child,grandchild)).toBe(false)
  })
})
