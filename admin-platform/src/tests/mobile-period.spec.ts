import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { PhaseCTopbar,periods } from '../phaseC/Layout'
import type { ApiVenue } from '../api'

const venue:ApiVenue={id:'venue-a',companyId:'company-a',companyName:'Company A',companyCode:'a',code:'a',name:'Venue A',address:null,legacyBarId:null}
let node:HTMLDivElement,root:Root
const onPeriod=vi.fn()
const props={role:'VENUE_ADMIN' as const,adminName:'Venue Owner',mode:'production' as const,venues:[venue],venueId:venue.id,compare:false,
  onMenu:vi.fn(),onVenue:vi.fn(),onPeriod,onCompare:vi.fn(),onMode:vi.fn(),onLogout:vi.fn()}

beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});onPeriod.mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node)})
afterEach(async()=>{await act(async()=>root.unmount());node.remove()})

describe('Business analytics period on compact screens',()=>{
  it('offers the desktop periods and forwards select changes',async()=>{
    await act(async()=>root.render(createElement(PhaseCTopbar,{...props,period:'30 дней'})))
    const select=node.querySelector<HTMLSelectElement>('.mobile-period-bar select')
    expect(select).not.toBeNull()
    expect(select?.getAttribute('id')).toBe('business-mobile-period')
    expect(node.querySelector('label[for="business-mobile-period"]')?.textContent).toBe('Период аналитики')
    expect([...select!.options].map(option=>option.value)).toEqual([...periods])
    expect(select!.value).toBe('30 дней')
    expect(node.querySelectorAll('.periods.desktop-only button')).toHaveLength(periods.length+1)

    await act(async()=>{
      select!.value='7 дней'
      select!.dispatchEvent(new Event('change',{bubbles:true}))
    })
    expect(onPeriod).toHaveBeenCalledOnce()
    expect(onPeriod).toHaveBeenCalledWith('7 дней')

    await act(async()=>root.render(createElement(PhaseCTopbar,{...props,period:'7 дней'})))
    expect(select!.value).toBe('7 дней')
  })
})
