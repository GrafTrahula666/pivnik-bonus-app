import {describe,expect,it} from 'vitest'
import {BEER_CATALOG,filterBeerCatalog,parsePositiveLiters} from '../phaseC/beer-catalog'
describe('PIVNIK tap chooser',()=>{
 it('contains 28 current manually counted taps without duplicate product keys',()=>{
   expect(BEER_CATALOG).toHaveLength(28)
   expect(new Set(BEER_CATALOG.map(v=>v.id)).size).toBe(28)
 })
 it('searches names and common aliases without changing product identity',()=>{
   expect(filterBeerCatalog('хадыга')[0]?.name).toBe('Хадыженское')
   expect(filterBeerCatalog('жигули')[0]?.name).toBe('Жигулёвское')
   expect(filterBeerCatalog('премиум')[0]?.name).toBe('Премиум пшено')
 })
 it('accepts only positive liters with up to three decimal digits',()=>{
   expect(parsePositiveLiters('12,5')).toBe(12.5)
   expect(parsePositiveLiters('0.593')).toBe(.593)
   for(const value of ['-1','0','2.1234','10001','1e5',''])expect(parsePositiveLiters(value)).toBeNull()
 })
})
