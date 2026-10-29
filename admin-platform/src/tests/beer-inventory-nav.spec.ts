import {createElement} from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {describe,it,expect} from 'vitest'
import {PhaseCSidebar} from '../phaseC/Layout'
describe('owner navigation inventory feature scope',()=>{
 const sidebar=(extra={})=>renderToStaticMarkup(createElement(PhaseCSidebar,{page:'overview',role:'VENUE_ADMIN',mode:'production',open:true,onClose(){},onPage(){},inventoryEnabled:true,...extra}))
 it('replaces appearance with beer inventory only when enabled for an owner',()=>{
  expect(sidebar()).toContain('Остатки пива');expect(sidebar()).not.toContain('Оформление')
  expect(sidebar({restricted:true})).not.toContain('Остатки пива')
  expect(sidebar({inventoryEnabled:false})).not.toContain('Остатки пива')
  expect(sidebar({mode:'demo'})).not.toContain('Остатки пива')
 })
})
