import { afterEach,describe,expect,it } from 'vitest'
import { config } from '../config.js'
import { setAppFetchForTests } from '../pivnik-app-link.js'
import { getAppWheel,saveAppWheel,wheelInput } from '../pivnik-app-wheel.js'
import type { AdminPrincipal,VenueScope } from '../types.js'

const admin={id:'7',email:'a@test',displayName:'Влад',role:'VENUE_ADMIN'} as AdminPrincipal
const pivnik={companyCode:'pivnik',legacyBarId:'1'} as VenueScope
const settings={chances:{'bonus-5':40,'bonus-10':20,'bonus-20':20,'bonus-50':10,'bonus-100':5,'beer-glass':5},firstPaidCost:50,nextPaidCost:100,freeIntervalHours:24}
const wheel={settings,prizes:[],last30Days:{spins:0,paidSpins:0,bonusSpent:0,bonusAwarded:0,beerAwardedMl:0,guests:0},updatedAt:null,updatedBy:null}

describe('Business wheel settings',()=>{
  const saved={...config}
  afterEach(()=>{Object.assign(config,saved);setAppFetchForTests(null)})
  const ready=()=>Object.assign(config,{enableWrites:true,pivnikAppUrl:'https://app.test',businessInternalToken:'t'.repeat(40)})

  it('reads from the app, or reports that the link is missing',async()=>{
    Object.assign(config,{pivnikAppUrl:'',businessInternalToken:''})
    expect(await getAppWheel(pivnik)).toEqual({configured:false})
    ready();setAppFetchForTests(async()=>new Response(JSON.stringify(wheel)))
    expect(await getAppWheel(pivnik)).toMatchObject({configured:true,settings:{firstPaidCost:50}})
    await expect(getAppWheel({companyCode:'other',legacyBarId:null} as unknown as VenueScope)).rejects.toMatchObject({code:'APP_CONTENT_NOT_LINKED'})
  })

  it('sends the settings and who changed them',async()=>{
    ready()
    const bodies:unknown[]=[]
    setAppFetchForTests(async(_url,init)=>{if(init?.body)bodies.push(JSON.parse(String(init.body)));return new Response(JSON.stringify(wheel))})
    await saveAppWheel(admin,pivnik,{...settings,firstPaidCost:'30'})
    expect(bodies).toEqual([{settings:{...settings,firstPaidCost:30},updatedBy:'Влад'}])
    expect(()=>wheelInput({})).toThrow(expect.objectContaining({code:'WHEEL_CHANCES_INVALID'}))
    Object.assign(config,{enableWrites:false})
    await expect(saveAppWheel(admin,pivnik,settings)).rejects.toMatchObject({code:'WRITES_DISABLED'})
  })

  it('passes the app refusal on to the panel',async()=>{
    ready()
    setAppFetchForTests(async(_url,init)=>init?.method==='PUT'
      ?new Response(JSON.stringify({error:'Сумма шансов должна быть ровно 100%, сейчас 99%.'}),{status:400})
      :new Response(JSON.stringify(wheel)))
    await expect(saveAppWheel(admin,pivnik,settings)).rejects.toMatchObject({message:expect.stringContaining('ровно 100%')})
  })
})
