import { describe,expect,it } from 'vitest'
import { compareValues,sortTableRows } from './TableSort'

describe('shared table ordering',()=>{
  it('uses numeric order for numbers and exact bigint money/volume',()=>{
    const numbers=[{amount:900},{amount:1000},{amount:75}]
    expect(sortTableRows(numbers,x=>x.amount,'desc').map(x=>x.amount)).toEqual([1000,900,75])
    const cents=[{amount:'900'},{amount:'1000'},{amount:'75'}]
    expect(sortTableRows(cents,x=>BigInt(x.amount),'desc').map(x=>x.amount)).toEqual(['1000','900','75'])
  })
  it('keeps missing values last in both directions',()=>{
    const rows=[{n:null},{n:0},{n:10}]
    expect(sortTableRows(rows,r=>r.n,'asc').map(x=>x.n)).toEqual([0,10,null])
    expect(sortTableRows(rows,r=>r.n,'desc').map(x=>x.n)).toEqual([10,0,null])
  })
  it('sorts Russian names and numeric strings naturally, without mutating source',()=>{
    const source=[{name:'Товар 10'},{name:'Товар 2'},{name:'Товар 1'}]
    expect(sortTableRows(source,x=>x.name,'asc').map(x=>x.name)).toEqual(['Товар 1','Товар 2','Товар 10'])
    expect(source[0]!.name).toBe('Товар 10')
    expect(compareValues('А','а','asc')).toBe(0)
  })
})
