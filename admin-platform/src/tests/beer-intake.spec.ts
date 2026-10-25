import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {ApiVenue} from '../api'

const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn()}))
vi.mock('../api',()=>({apiGet:api.get,apiPost:api.post}))
import {BeerIntake} from '../phaseC/BeerIntake'
const venue:ApiVenue={id:'1',companyId:'1',companyCode:'pivnik',companyName:'ПИВНИК',code:'pivnik',name:'ПИВНИК',address:null,legacyBarId:null}

describe('beer intake with provider safety gates',()=>{
 let host:HTMLDivElement,root:Root
 beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host)})
 afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()})
 it('shows the real selected product and block reason without permitting an unsafe addition',async()=>{
   api.get.mockResolvedValue({source:'evotor_cloud',writeEnabled:false,writeBlock:{code:'EVOTOR_STOCK_CONCURRENCY_UNSUPPORTED',message:'Добавление пока недоступно: не подтверждена защита продаж.'},products:[{
     id:'product-verified-id',name:'Хадыженское',quantity:24,measure_name:'л',updated_at:'2026-10-25T12:00:00Z',store_id:'store',type:'NORMAL',
   }]})
   await act(async()=>root.render(createElement(BeerIntake,{venue})))
   expect(host.textContent).toContain('24 л')
   expect(host.textContent).toContain('не подтверждена защита продаж')
   const choice=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Хадыженское'))!
   await act(async()=>choice.click())
   const input=host.querySelector<HTMLInputElement>('#beer-volume')!
   await act(async()=>{
     Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'50')
     input.dispatchEvent(new Event('input',{bubbles:true}))
   })
   const add=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Добавить в Эвотор')!
   expect(add.disabled).toBe(true);add.click();expect(api.post).not.toHaveBeenCalled()
 })
 it('keeps a provider permission failure visible instead of displaying an invented zero balance',async()=>{
   api.get.mockRejectedValue(new Error('Эвотор запретил чтение товаров (HTTP 403).'))
   await act(async()=>root.render(createElement(BeerIntake,{venue})))
   expect(host.querySelector('[role="alert"]')?.textContent).toContain('HTTP 403')
   expect(host.querySelector('.beer-intake-choice')).toBeNull()
   expect(host.textContent).not.toContain('0 л');expect(api.post).not.toHaveBeenCalled()
 })
})
