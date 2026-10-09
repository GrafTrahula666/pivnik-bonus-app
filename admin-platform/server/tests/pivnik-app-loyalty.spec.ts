import { afterEach,describe,expect,it } from 'vitest'
import { config } from '../config.js'
import { setAppFetchForTests } from '../pivnik-app-link.js'
import { getAppLoyalty,loyaltyInput,saveAppLoyalty } from '../pivnik-app-loyalty.js'
import { loadPivnikStatusLevels,parseStoredLevels,resetPivnikStatusLevelsCache,resolvePivnikLegacyStatus } from '../legacy-compat.js'
import type { AdminPrincipal,VenueScope } from '../types.js'

const admin={id:'7',email:'a@test',displayName:'Влад',role:'VENUE_ADMIN'} as AdminPrincipal
const pivnik={companyCode:'pivnik',legacyBarId:'1'} as VenueScope
const loyalty={levels:[{name:'Путник',minCents:0,bonusPercent:5,discountPercent:0,guests:3}],welcomeBonus:100,updatedAt:null,updatedBy:null}

describe('Business loyalty levels',()=>{
  const saved={...config}
  afterEach(()=>{Object.assign(config,saved);setAppFetchForTests(null);resetPivnikStatusLevelsCache()})
  const ready=()=>Object.assign(config,{enableWrites:true,pivnikAppUrl:'https://app.test',businessInternalToken:'t'.repeat(40)})

  it('reads from the app, or reports that the link is missing',async()=>{
    Object.assign(config,{pivnikAppUrl:'',businessInternalToken:''})
    expect(await getAppLoyalty(pivnik)).toEqual({configured:false})
    ready();setAppFetchForTests(async()=>new Response(JSON.stringify(loyalty)))
    expect(await getAppLoyalty(pivnik)).toMatchObject({configured:true,welcomeBonus:100})
  })

  it('sends the levels and who changed them',async()=>{
    ready()
    const bodies:unknown[]=[]
    setAppFetchForTests(async(_url,init)=>{if(init?.body)bodies.push(JSON.parse(String(init.body)));return new Response(JSON.stringify(loyalty))})
    await saveAppLoyalty(admin,pivnik,{welcomeBonus:50,levels:[{name:' Новичок ',minCents:0,bonusPercent:4}]})
    expect(bodies).toEqual([{settings:{welcomeBonus:50,levels:[{name:'Новичок',minCents:0,bonusPercent:4,discountPercent:0}]},updatedBy:'Влад'}])
    expect(()=>loyaltyInput({levels:[]})).toThrow(expect.objectContaining({code:'LEVELS_INVALID'}))
    Object.assign(config,{enableWrites:false})
    await expect(saveAppLoyalty(admin,pivnik,{levels:[{}]})).rejects.toMatchObject({code:'WRITES_DISABLED'})
  })

  it('shows client levels by the levels saved in the app',async()=>{
    const stored={levels:[{name:'Новичок',minCents:0,bonusPercent:3},{name:'Свой',minCents:500_000,bonusPercent:8}],welcomeBonus:0}
    const levels=await loadPivnikStatusLevels({query:async()=>({rows:[{value:stored}]})})
    expect(resolvePivnikLegacyStatus(600_000,levels)).toMatchObject({name:'Свой',bonusPercent:8,nextCents:null})
    expect(levels[0]!.nextCents).toBe(500_000)
    resetPivnikStatusLevelsCache()
    const fallback=await loadPivnikStatusLevels({query:async()=>{throw new Error('relation does not exist')}})
    expect(fallback[0]!.name).toBe('Путник')
    expect(parseStoredLevels({levels:[{name:'A',minCents:100,bonusPercent:5}]})).toBeNull()
  })
})
