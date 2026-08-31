import {describe,expect,it} from 'vitest'
import {
  PIVNIK_LEGACY_ACHIEVEMENTS,
  PIVNIK_LEGACY_WHEEL_PRIZES,
  PIVNIK_RUNTIME_COMMIT,
  PIVNIK_WHEEL_TICKET_COUNT,
} from '../pivnik-legacy-catalog.js'

describe('Pivnik production legacy read catalog',()=>{
  it('mirrors the pinned production runtime commit',()=>{
    expect(PIVNIK_RUNTIME_COMMIT).toBe('f49c69dbdd50711b15d907e3096fca1125a639d6')
  })

  it('covers the entire 500000-ticket wheel with exact production prize codes',()=>{
    expect(PIVNIK_WHEEL_TICKET_COUNT).toBe(500_000)
    expect(PIVNIK_LEGACY_WHEEL_PRIZES.map(x=>x.code)).toEqual([
      'bonus-5','bonus-10','bonus-20','bonus-50','bonus-100','beer-glass','annual-beer',
    ])
    expect(PIVNIK_LEGACY_WHEEL_PRIZES.reduce((sum,x)=>sum+x.tickets,0)).toBe(500_000)
    expect(PIVNIK_LEGACY_WHEEL_PRIZES.reduce((sum,x)=>sum+Number(x.probability),0)).toBeCloseTo(100,10)
    expect(PIVNIK_LEGACY_WHEEL_PRIZES.find(x=>x.code==='annual-beer')?.probability).toBe('0.0002')
    expect(PIVNIK_LEGACY_WHEEL_PRIZES.find(x=>x.code==='beer-glass')?.probability).toBe('4.9998')
  })

  it('contains the current 18 countable definitions plus the 3 current special runtime achievements',()=>{
    expect(PIVNIK_LEGACY_ACHIEVEMENTS).toHaveLength(21)
    const codes=new Set(PIVNIK_LEGACY_ACHIEVEMENTS.map(x=>x.code))
    for(const code of [
      'first-purchase','single-check-1000','three-purchases','three-paid-liters',
      'first-redemption','first-shop-purchase','ten-purchases','single-check-3000',
      'total-spend-10000','fifteen-paid-liters','five-visit-days','spend-500-bonus',
      'monthly-top-spender','fifty-purchases','single-check-7000','total-spend-50000',
      'fifty-paid-liters','twenty-visit-days','beta-tester','creator','raise-shields',
    ])expect(codes.has(code),`missing ${code}`).toBe(true)
  })

  it('preserves production special rewards',()=>{
    const byCode=Object.fromEntries(PIVNIK_LEGACY_ACHIEVEMENTS.map(x=>[x.code,x]))
    expect(byCode['beta-tester']?.rewardBonus).toBe(150)
    expect(byCode['creator']?.rewardBonus).toBe(0)
    expect(byCode['raise-shields']?.rewardBonus).toBe(750)
    expect(byCode['monthly-top-spender']?.rewardBeerMl).toBe(500)
  })
})
