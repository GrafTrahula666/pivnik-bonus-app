import { afterEach,describe,expect,it } from 'vitest'
import { config } from '../config.js'
import { createAppPromotion,listAppPromotions,validateDesignInput,validatePromotionInput } from '../pivnik-app-content.js'
import type { AdminPrincipal,VenueScope } from '../types.js'

const admin={id:'1',email:'a@test',displayName:'A',role:'VENUE_ADMIN'} as AdminPrincipal
const north={companyCode:'north',legacyBarId:'2'} as VenueScope
const pivnik={companyCode:'pivnik',legacyBarId:'1'} as VenueScope
const design={texts:{brand:'Пивник',balanceLabel:'Баланс',byline:'by K',qrButton:'QR'},sections:{promos:true,team:false,byline:true},radius:20,theme:'default'}

describe('guest app promotions input',()=>{
  it('needs a title and trims long fields to the app limits',()=>{
    expect(()=>validatePromotionInput({title:'  '})).toThrow(expect.objectContaining({code:'TITLE_REQUIRED'}))
    const v=validatePromotionInput({title:'x'.repeat(200),badge:'b'.repeat(60),sortOrder:99999})
    expect(v.title).toHaveLength(120);expect(v.badge).toHaveLength(40);expect(v.sortOrder).toBe(9999);expect(v.active).toBe(true)
  })
  it('keeps the picture when imageSrc is left out and removes it on an empty string',()=>{
    expect('imageSrc' in validatePromotionInput({title:'A'})).toBe(false)
    expect(validatePromotionInput({title:'A',imageSrc:''}).imageSrc).toBeNull()
    expect(validatePromotionInput({title:'A',imageSrc:'https://x.test/a.png'}).imageSrc).toBe('https://x.test/a.png')
    expect(validatePromotionInput({title:'A',imageSrc:'data:image/png;base64,AAAA'}).imageSrc).toBe('data:image/png;base64,AAAA')
  })
  it('refuses scripts, http links and oversized uploads as pictures',()=>{
    for(const imageSrc of ['javascript:alert(1)','http://x.test/a.png','data:text/html;base64,AAAA'])
      expect(()=>validatePromotionInput({title:'A',imageSrc})).toThrow(expect.objectContaining({code:'IMAGE_INVALID'}))
    expect(()=>validatePromotionInput({title:'A',imageSrc:`data:image/png;base64,${'A'.repeat(3_300_000)}`})).toThrow(expect.objectContaining({code:'IMAGE_TOO_LARGE'}))
  })
})

describe('guest app design input',()=>{
  it('accepts the app design fields',()=>{expect(validateDesignInput(design)).toEqual(design)})
  it('needs a brand, a radius from 8 to 36 and a known theme',()=>{
    expect(()=>validateDesignInput({...design,texts:{...design.texts,brand:''}})).toThrow(expect.objectContaining({code:'BRAND_REQUIRED'}))
    expect(()=>validateDesignInput({...design,radius:40})).toThrow(expect.objectContaining({code:'RADIUS_INVALID'}))
    expect(()=>validateDesignInput({...design,theme:'neon'})).toThrow(expect.objectContaining({code:'THEME_INVALID'}))
  })
})

describe('guest app content scope',()=>{
  const saved={...config}
  afterEach(()=>Object.assign(config,saved))
  it('is only for the PIVNIK venue',async()=>{
    await expect(listAppPromotions(north)).rejects.toMatchObject({code:'APP_CONTENT_NOT_LINKED'})
    Object.assign(config,{enableWrites:true})
    await expect(createAppPromotion(admin,north,{title:'A'})).rejects.toMatchObject({code:'APP_CONTENT_NOT_LINKED'})
  })
  it('refuses writes while the global write switch is off',async()=>{
    Object.assign(config,{enableWrites:false})
    await expect(createAppPromotion(admin,pivnik,{title:'A'})).rejects.toMatchObject({code:'WRITES_DISABLED'})
  })
})
