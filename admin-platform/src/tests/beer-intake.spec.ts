import {describe, expect, it} from 'vitest'
import {parseBeerIntake} from '../phaseC/beer-intake'

describe('beer intake: text-only, no provider mutations',()=>{
  it('converts mixed kegs and liters without silently assuming keg size',()=>{
    const data = parseBeerIntake('Хадыженское +2 кеги по 50 л\nПилснер +1 кега 30 л\nБарное +15 л')
    expect(data.errors).toEqual([])
    expect(data.rows.map(row=>[row.name,row.liters])).toEqual([['Хадыженское',100],['Пилснер',30],['Барное',15]])
  })
  it('rejects missing keg size and unknown phrases',()=>{
    const data=parseBeerIntake('Пилснер 2 кеги\nОранж бланш почти полная')
    expect(data.rows).toHaveLength(0)
    expect(data.errors).toHaveLength(2)
  })
  it('rejects duplicate products instead of doubling an arrival',()=>{
    const duplicated=parseBeerIntake('Хадыженское +30 л\nХадыженское +20 л')
    expect(duplicated.rows).toHaveLength(1)
    expect(duplicated.errors[0]?.line).toBe(2)
    expect(parseBeerIntake('Жигулёвское +30 л\nЖигулевское +20 л').errors).toHaveLength(1)
  })
  it('handles comma decimals and original line numbers',()=>{
    const data=parseBeerIntake('\n  Медовуха +0,5 кеги по 30 л\n')
    expect(data.rows[0]).toMatchObject({line:2,liters:15,kegCount:0.5,litersPerKeg:30})
  })
  it('does not interpret negative, empty or excessive changes as deliveries',()=>{
    const data=parseBeerIntake('Хадыженское -2 кеги по 50 л\nБарное +0 л\nПилснер +10001 л')
    expect(data.rows).toHaveLength(0)
    expect(data.errors).toHaveLength(3)
  })
})
