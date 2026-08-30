import { describe,expect,it } from 'vitest'
import {
  percentToPpb,ppbToPercent,promotionState,validateBonusAdjustmentInput,
  validateLoyalty,validateWheel,
} from '../writes.js'

describe('bonus write validation',()=>{
  const valid={type:'credit',amount:100,reason:'Service recovery',idempotencyKey:'bonus:test:123456'}
  it('accepts a finite positive safe integer',()=>expect(validateBonusAdjustmentInput(valid,'12').amount).toBe(100))
  it.each([0,-1,NaN,Infinity,1.5,1_000_001])('rejects invalid amount %s',(amount:number)=>{
    expect(()=>validateBonusAdjustmentInput({...valid,amount},'12')).toThrow()
  })
  it('rejects forged user id',()=>expect(()=>validateBonusAdjustmentInput(valid,'12 OR 1=1')).toThrow())
  it('requires meaningful reason',()=>expect(()=>validateBonusAdjustmentInput({...valid,reason:'x'},'12')).toThrow())
})

describe('loyalty validation',()=>{
  it('accepts increasing thresholds',()=>expect(validateLoyalty({
    baseCashbackPercent:5,registrationBonus:100,referralBonus:0,
    levels:[
      {code:'a',title:'A',thresholdRub:0,bonusPercent:5,discountPercent:0,enabled:true,sortOrder:0},
      {code:'b',title:'B',thresholdRub:10000,bonusPercent:7,discountPercent:0,enabled:true,sortOrder:1},
    ],
  }).levels).toHaveLength(2))
  it('rejects non-increasing active thresholds',()=>expect(()=>validateLoyalty({
    baseCashbackPercent:5,registrationBonus:100,referralBonus:0,
    levels:[
      {code:'a',title:'A',thresholdRub:100,bonusPercent:5,enabled:true,sortOrder:0},
      {code:'b',title:'B',thresholdRub:100,bonusPercent:7,enabled:true,sortOrder:1},
    ],
  })).toThrow())
})

describe('wheel exact probabilities',()=>{
  it('preserves a one-in-a-billion share',()=>{
    expect(percentToPpb('0.0000001')).toBe(1n)
    expect(ppbToPercent(1n)).toBe('0.0000001')
  })
  it('accepts exactly 100% using decimal strings',()=>expect(validateWheel({
    enabled:true,cooldownMinutes:1440,retryCost:50,
    prizes:[
      {code:'rare',title:'Rare',rewardType:'item',rewardValue:{code:'rare'},probability:'0.0000001',inventoryLimit:1,enabled:true,sortOrder:0},
      {code:'rest',title:'Rest',rewardType:'none',rewardValue:{},probability:'99.9999999',inventoryLimit:null,enabled:true,sortOrder:1},
    ],
  }).prizes).toHaveLength(2))
  it('rejects total other than 100%',()=>expect(()=>validateWheel({
    enabled:true,cooldownMinutes:1440,retryCost:50,
    prizes:[{code:'a',title:'A',rewardType:'bonus',rewardValue:{amount:1},probability:'99.9',inventoryLimit:null,enabled:true,sortOrder:0}],
  })).toThrow())
  it('ignores disabled prize in published probability total',()=>expect(validateWheel({
    enabled:true,cooldownMinutes:1440,retryCost:0,
    prizes:[
      {code:'active',title:'A',rewardType:'none',rewardValue:{},probability:'100',inventoryLimit:null,enabled:true,sortOrder:0},
      {code:'off',title:'Off',rewardType:'bonus',rewardValue:{amount:5},probability:'22',inventoryLimit:null,enabled:false,sortOrder:1},
    ],
  }).prizes).toHaveLength(2))
})

describe('promotion server state',()=>{
  const now=new Date('2026-08-29T10:00:00Z')
  it('DISABLED wins',()=>expect(promotionState({enabled:false,starts_at:'2026-08-30T00:00:00Z'},now)).toBe('DISABLED'))
  it('SCHEDULED before start',()=>expect(promotionState({enabled:true,starts_at:'2026-08-30T00:00:00Z'},now)).toBe('SCHEDULED'))
  it('ACTIVE inside period',()=>expect(promotionState({enabled:true,starts_at:'2026-08-28T00:00:00Z',ends_at:'2026-08-30T00:00:00Z'},now)).toBe('ACTIVE'))
  it('FINISHED after end',()=>expect(promotionState({enabled:true,ends_at:'2026-08-29T09:00:00Z'},now)).toBe('FINISHED'))
})
