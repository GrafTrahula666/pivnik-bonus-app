// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {buildServerTimeSeries} from '../time-series.js'

const period={from:'2026-10-01T21:00:00.000Z',to:'2026-10-03T21:00:00.000Z'}
const scope={companyId:'10',venueId:'101',period}

describe('CHAT 09 / 82 common server chart aggregates',()=>{
  it('keeps exact signed minor units, sorted days and folded Moscow clock-hours',()=>{
    const result=buildServerTimeSeries({...scope,source:'evotor_pos',metric:'net_cash',currency:null,
      days:[{label:'2026-10-03',amountCents:'-75'},{label:'2026-10-02',amountCents:'9007199254740994'}],
      hours:[{label:'23',amountCents:'9007199254740994'},{label:'01',amountCents:'-75'}]})
    expect(result.schemaVersion).toBe(1)
    expect(result.scope).toEqual({companyId:'10',venueId:'101'})
    expect(result.currency).toBeNull() // POS document does not authoritatively identify currency
    expect(result.unit).toBe('minor_currency_units')
    expect(result.groups.days.buckets).toEqual([
      {label:'2026-10-02',amountCents:'9007199254740994'},
      {label:'2026-10-03',amountCents:'-75'}])
    expect(result.groups.hours).toEqual({grain:'hour_of_day',foldedAcrossDays:true,buckets:[
      {label:'01',amountCents:'-75'},{label:'23',amountCents:'9007199254740994'}]})
    expect(result.coverage).toBe('read_model_only')
  })
  it('distinguishes hourly not requested from confirmed empty and preserves source/metric identity',()=>{
    const base={...scope,source:'pivnik_loyalty' as const,metric:'tracked_cash' as const,currency:'RUB' as const,
      days:[]}
    expect(buildServerTimeSeries({...base,hours:null}).groups.hours).toBeNull()
    expect(buildServerTimeSeries({...base,hours:[]}).groups.hours?.buckets).toEqual([])
    expect(buildServerTimeSeries({...base,hours:[]}).metric).toBe('tracked_cash')
  })
  it('rejects malformed/duplicate buckets, invalid calendar days and incompatible totals',()=>{
    const base={...scope,source:'evotor_pos' as const,metric:'net_cash' as const,currency:null,days:[],hours:null}
    for(const days of [
      [{label:'2026-02-30',amountCents:'1'}],
      [{label:'2026-10-02',amountCents:'1'},{label:'2026-10-02',amountCents:'2'}],
      [{label:'2026-10-02',amountCents:'1.01'}],
    ])expect(()=>buildServerTimeSeries({...base,days})).toThrow()
    expect(()=>buildServerTimeSeries({...base,days:[{label:'2026-10-02',amountCents:'100'}],
      hours:[{label:'02',amountCents:'50'}]})).toThrow('AGGREGATE_GROUPING_MISMATCH')
    expect(()=>buildServerTimeSeries({...base,hours:[{label:'24',amountCents:'0'}]})).toThrow()
    expect(()=>buildServerTimeSeries({...base,companyId:''})).toThrow()
    expect(()=>buildServerTimeSeries({...base,period:{...period,to:period.from}})).toThrow()
  })
})
