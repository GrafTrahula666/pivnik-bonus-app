// @vitest-environment node
import {describe,expect,it} from 'vitest'
import {parseOperationsPeriod} from '../data.js'

const now=new Date('2026-10-25T21:30:00.000Z') // Already October 26 in Moscow
const parse=(query:string)=>parseOperationsPeriod(new URL('https://fixture.invalid/dashboard'+query),now)
const bounds=(query:string)=>{
  const result=parse(query)
  return {from:result.from.toISOString(),to:result.to.toISOString(),days:result.days}
}

describe('application operations date windows (Moscow calendar)',()=>{
  it('uses today, yesterday and preset ranges without midnight ambiguity',()=>{
    expect(bounds('?days=1')).toEqual({from:'2026-10-25T21:00:00.000Z',to:'2026-10-26T21:00:00.000Z',days:1})
    expect(bounds('?days=7').days).toBe(7)
    expect(bounds('?days=14').days).toBe(14)
    expect(bounds('?days=365').days).toBe(365)
    expect(bounds('')).toEqual(bounds('?days=30'))
    expect(bounds('?date=2026-10-25')).toEqual({from:'2026-10-24T21:00:00.000Z',to:'2026-10-25T21:00:00.000Z',days:1})
  })
  it('makes arbitrary start/end inclusive and allows older than one year for one day',()=>{
    expect(bounds('?from=2026-10-11&to=2026-10-25')).toEqual({
      from:'2026-10-10T21:00:00.000Z',to:'2026-10-25T21:00:00.000Z',days:15,
    })
    expect(bounds('?date=2022-02-01').days).toBe(1)
    expect(bounds('?from=2024-02-28&to=2024-02-29').days).toBe(2)
  })
  it('rejects future, reversed, malformed, duplicate, mixed or too-long ranges',()=>{
    const invalid=[
      '?date=2026-10-27','?date=2026-02-30','?date=not-a-day','?days=2','?days=366',
      '?days=30&date=2026-10-25','?date=2026-10-25&date=2026-10-24',
      '?from=2026-10-24','?to=2026-10-25','?from=2026-10-25&to=2026-10-24',
      '?from=2023-01-01&to=2026-10-25','?from=2026-10-26&to=2026-10-27',
      '?from=2026-10-25&to=2026-10-25&to=2026-10-26',
    ]
    for(const query of invalid)expect(()=>parse(query),query).toThrow()
  })
  it('allows the exact 366 day limit when including a leap day',()=>{
    const fixed=new Date('2024-12-31T12:00:00Z')
    const range=parseOperationsPeriod(new URL('https://fixture.invalid/dashboard?from=2024-01-01&to=2024-12-31'),fixed)
    expect(range.days).toBe(366)
  })
})
