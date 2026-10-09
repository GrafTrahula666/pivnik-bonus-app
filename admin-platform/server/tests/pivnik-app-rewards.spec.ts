import { afterEach,describe,expect,it } from 'vitest'
import { config } from '../config.js'
import { setAppFetchForTests } from '../pivnik-app-link.js'
import { achievementSettingsInput,getAppRewards,grantGuestAchievement,grantGuestFrame,revokeGuestFrame,saveAppAchievements } from '../pivnik-app-rewards.js'
import type { AdminPrincipal,VenueScope } from '../types.js'

const admin={id:'7',email:'a@test',displayName:'Влад',role:'VENUE_ADMIN'} as AdminPrincipal
const pivnik={companyCode:'pivnik',legacyBarId:'1'} as VenueScope
const north={companyCode:'north',legacyBarId:'2'} as VenueScope
const token='t'.repeat(40)
const catalog={achievements:[{code:'first-purchase',title:'Первый тост',enabled:true,rewardBonus:10,manual:false}],frames:[],updatedAt:null,updatedBy:null}

describe('Business achievements and frames',()=>{
  const saved={...config}
  afterEach(()=>{Object.assign(config,saved);setAppFetchForTests(null)})
  const ready=()=>Object.assign(config,{enableWrites:true,pivnikAppUrl:'https://app.test',businessInternalToken:token})
  const record=(response:(url:string,init:RequestInit)=>unknown,status=200)=>{
    const calls:Array<{url:string;method:string;body:unknown}>=[]
    setAppFetchForTests(async(url,init)=>{calls.push({url:String(url),method:String(init?.method),body:init?.body?JSON.parse(String(init.body)):null})
      return new Response(JSON.stringify(response(String(url),init!)),{status})})
    return calls
  }

  it('falls back to read-only without the app link and refuses other companies',async()=>{
    Object.assign(config,{pivnikAppUrl:'',businessInternalToken:''})
    expect(await getAppRewards(pivnik)).toEqual({configured:false})
    await expect(getAppRewards(north)).rejects.toMatchObject({code:'APP_CONTENT_NOT_LINKED'})
    ready();Object.assign(config,{enableWrites:false})
    await expect(grantGuestFrame(admin,pivnik,'5',{code:'fire'})).rejects.toMatchObject({code:'WRITES_DISABLED'})
  })

  it('sends only overrides and own achievements to the app',()=>{
    expect(achievementSettingsInput({achievements:[
      {code:'first-purchase',enabled:false,rewardBonus:25,title:'Первый тост'},
      {code:'custom-hero',manual:true,title:' Герой ',description:'',rarity:'epic',rewardBonus:100},
    ]})).toEqual({overrides:{'first-purchase':{enabled:false,rewardBonus:25}},custom:[{code:'custom-hero',title:'Герой',description:'',rarity:'epic',rewardBonus:100}]})
    expect(()=>achievementSettingsInput({achievements:[{code:'x',rewardBonus:-5}]})).toThrow(expect.objectContaining({code:'REWARD_INVALID'}))
    expect(()=>achievementSettingsInput({})).toThrow(expect.objectContaining({code:'ACHIEVEMENTS_INVALID'}))
  })

  it('saves the catalog through the app with who changed it',async()=>{
    ready()
    const calls=record(()=>catalog)
    await saveAppAchievements(admin,pivnik,{achievements:[{code:'first-purchase',enabled:true,rewardBonus:15}]})
    expect(calls.map(c=>`${c.method} ${c.url}`)).toEqual(['GET https://app.test/api/internal/business/rewards','PUT https://app.test/api/internal/business/rewards/achievements'])
    expect(calls[1]!.body).toEqual({settings:{overrides:{'first-purchase':{enabled:true,rewardBonus:15}},custom:[]},updatedBy:'Влад'})
  })

  it('grants an achievement, gives and takes back a frame on the guest',async()=>{
    ready()
    const calls=record(url=>url.endsWith('/achievements')?{granted:{code:'custom-hero',title:'Герой',rewardBonus:100,rewardBeerMl:0,balance:100},rewards:{}}:{selectedFrame:'none',achievements:[],frames:[]})
    expect((await grantGuestAchievement(admin,pivnik,'42',{code:'custom-hero'})).granted.rewardBonus).toBe(100)
    await grantGuestFrame(admin,pivnik,'42',{code:'fire'})
    await revokeGuestFrame(admin,pivnik,'42','fire')
    expect(calls.map(c=>`${c.method} ${c.url.replace('https://app.test/api/internal/business','')}`)).toEqual([
      'POST /users/42/achievements','POST /users/42/frames','DELETE /users/42/frames/fire'])
    await expect(grantGuestFrame(admin,pivnik,'4x',{code:'fire'})).rejects.toMatchObject({code:'USER_ID_INVALID'})
    await expect(grantGuestFrame(admin,pivnik,'42',{code:'../x'})).rejects.toMatchObject({code:'CODE_INVALID'})
  })

  it('passes on the app refusal text',async()=>{
    ready()
    record(()=>({error:'У гостя уже есть это достижение.'}),409)
    await expect(grantGuestAchievement(admin,pivnik,'42',{code:'first-purchase'})).rejects.toMatchObject({statusCode:409,message:'У гостя уже есть это достижение.'})
    record(()=>({error:'Гость не найден.'}),404)
    await expect(grantGuestFrame(admin,pivnik,'42',{code:'fire'})).rejects.toMatchObject({message:'Гость не найден.'})
    record(()=>({error:'Not found'}),404)
    await expect(grantGuestFrame(admin,pivnik,'42',{code:'fire'})).rejects.toMatchObject({statusCode:502,code:'APP_REWARDS_ERROR'})
  })
})
