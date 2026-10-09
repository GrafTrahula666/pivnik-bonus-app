import { afterEach,describe,expect,it } from 'vitest'
import { config } from '../config.js'
import { getBroadcastPreview,sendBroadcast,setBroadcastFetchForTests,validateBroadcastInput } from '../pivnik-broadcast.js'
import type { AdminPrincipal,VenueScope } from '../types.js'

const admin={id:'7',email:'a@test',displayName:'A',role:'VENUE_ADMIN'} as AdminPrincipal
const pivnik={companyCode:'pivnik',legacyBarId:'1'} as VenueScope
const north={companyCode:'north',legacyBarId:'2'} as VenueScope
const token='t'.repeat(40)

describe('Business broadcasts',()=>{
  const saved={...config}
  afterEach(()=>{Object.assign(config,saved);setBroadcastFetchForTests(null)})
  const ready=()=>Object.assign(config,{enableWrites:true,pivnikAppUrl:'https://app.test',businessInternalToken:token})

  it('checks channel, audience and text like the app does',()=>{
    expect(()=>validateBroadcastInput({channel:'sms',message:'x'})).toThrow(expect.objectContaining({code:'CHANNEL_INVALID'}))
    expect(()=>validateBroadcastInput({channel:'all',audience:'staff',message:'x'})).toThrow(expect.objectContaining({code:'AUDIENCE_INVALID'}))
    expect(()=>validateBroadcastInput({channel:'all',message:'  '})).toThrow(expect.objectContaining({code:'MESSAGE_REQUIRED'}))
    expect(()=>validateBroadcastInput({channel:'all',message:'x'.repeat(3001)})).toThrow(expect.objectContaining({code:'MESSAGE_TOO_LONG'}))
    expect(validateBroadcastInput({channel:'vk',message:' Привет '})).toEqual({channel:'vk',audience:'clients',message:'Привет'})
  })

  it('stays off until the app address and a long token are configured, and only for PIVNIK',async()=>{
    Object.assign(config,{enableWrites:true,pivnikAppUrl:'https://app.test',businessInternalToken:'short'})
    await expect(getBroadcastPreview(pivnik,'clients')).rejects.toMatchObject({code:'BROADCAST_NOT_CONFIGURED'})
    ready()
    await expect(getBroadcastPreview(north,'clients')).rejects.toMatchObject({code:'APP_CONTENT_NOT_LINKED'})
    Object.assign(config,{enableWrites:false})
    await expect(sendBroadcast(admin,pivnik,{channel:'all',message:'x'})).rejects.toMatchObject({code:'WRITES_DISABLED'})
  })

  it('sends through the app with the service token and returns its delivery counts',async()=>{
    ready()
    const calls:Array<{url:string;init:RequestInit}>=[]
    setBroadcastFetchForTests(async(url,init)=>{calls.push({url:String(url),init:init!});return new Response(JSON.stringify({ok:true,deduplicated:false,campaignId:'5',totalUsers:2,truncated:false,telegram:{attempted:2,delivered:2,failed:0},vk:{attempted:0,delivered:0,failed:0}}),{status:200})})
    const r=await sendBroadcast(admin,pivnik,{channel:'telegram',audience:'clients',message:'Пятница'})
    expect(r.telegram.delivered).toBe(2)
    expect(calls[0]!.url).toBe('https://app.test/api/internal/business/broadcast')
    expect((calls[0]!.init.headers as Record<string,string>)['x-business-token']).toBe(token)
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({channel:'telegram',audience:'clients',message:'Пятница'})
  })

  it('passes on the app refusal text, but hides a token mismatch behind a generic error',async()=>{
    ready()
    setBroadcastFetchForTests(async()=>new Response(JSON.stringify({error:'Такая рассылка уже выполняется.'}),{status:409}))
    await expect(getBroadcastPreview(pivnik,'clients')).rejects.toMatchObject({statusCode:409,message:'Такая рассылка уже выполняется.'})
    setBroadcastFetchForTests(async()=>new Response(JSON.stringify({error:'Нет доступа.'}),{status:401}))
    await expect(getBroadcastPreview(pivnik,'clients')).rejects.toMatchObject({statusCode:502,code:'BROADCAST_APP_ERROR'})
    setBroadcastFetchForTests(async()=>{throw new TypeError('fetch failed')})
    await expect(getBroadcastPreview(pivnik,'clients')).rejects.toMatchObject({code:'BROADCAST_APP_UNREACHABLE'})
  })
})
