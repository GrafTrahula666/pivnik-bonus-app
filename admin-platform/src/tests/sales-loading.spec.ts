import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { ProductionDashboard } from '../phaseC/ProductionDashboard'
import { ApiError,apiGet,type ApiVenue } from '../api'
vi.mock('../api',async()=>({...await vi.importActual('../api'),apiGet:vi.fn()}))
const venue:ApiVenue={id:'a',companyId:'company-a',companyName:'A',companyCode:'a',code:'a',name:'Venue A',address:null,legacyBarId:null}
const summary={salesCents:'30000',returnsCents:'1000',netCents:'29000',averageCents:'15000',receiptCount:2,saleDocuments:2,returnDocuments:1,days:[],payments:[]}
const report={connection:{state:'connected',lastSuccessAt:'2026-10-02T12:00:00Z'},all:summary,app:{...summary,salesCents:'11000',returnsCents:'1000',netCents:'10000',activeBuyers:1,repeatBuyers:0,repeatPurchaseRate:0,purchaseFrequency:1},unlinked:{...summary,salesCents:'19000',returnsCents:'0',netCents:'19000'},linkedRevenueSharePercent:36.66}
let node:HTMLDivElement,root:Root
async function render(v=venue,period:'30 дней'|'7 дней'='30 дней'){await act(async()=>root.render(createElement(ProductionDashboard,{venue:v,period,compare:false,onNavigate:()=>{}})))}
async function click(label:string){const button=[...node.querySelectorAll('button')].find(b=>b.textContent===label);expect(button).toBeTruthy();await act(async()=>button!.click())}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.mocked(apiGet).mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node)})
afterEach(async()=>{await act(async()=>root.unmount());node.remove()})
describe('actual sales component requests and state transitions',()=>{
 it('loads all cash first, retains stale values on retry errors and malformed JSON, clears on access denial',async()=>{
  let resolve!:(v:unknown)=>void;vi.mocked(apiGet).mockImplementationOnce(()=>new Promise(r=>{resolve=r}) as never)
  await render();expect(node.textContent).toContain('Загрузка кассовых');expect(node.textContent).not.toContain('₽ 290,00')
  await act(async()=>resolve(report));expect(node.textContent).toContain('₽ 290,00');expect(node.querySelector('[aria-pressed="true"]')?.textContent).toBe('Все продажи кассы')
  await click('Клиенты приложения');expect(node.textContent).toContain('₽ 100,00');expect(node.textContent).not.toContain('₽ 290,00');expect(apiGet).toHaveBeenCalledTimes(1)
  await click('Все продажи кассы');vi.mocked(apiGet).mockRejectedValueOnce(new Error('Fixture outage'))
  await click('Обновить');expect(node.textContent).toContain('₽ 290,00');expect(node.textContent).toContain('Не обновлено')
  vi.mocked(apiGet).mockResolvedValueOnce({} as never);await click('Обновить');expect(node.textContent).toContain('₽ 290,00');expect(node.textContent).toContain('Некорректный ответ')
  vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(403,'SCOPE','Denied'));await click('Обновить');expect(node.textContent).not.toContain('₽ 290,00');expect(node.textContent).toContain('Denied')
 })
 it('venue/period changes remove previous cash and ignore late responses; disconnected never uses loyalty cash',async()=>{
  vi.mocked(apiGet).mockResolvedValueOnce(report as never);await render();expect(node.textContent).toContain('₽ 290,00')
  let late!:(v:unknown)=>void;vi.mocked(apiGet).mockImplementationOnce(()=>new Promise(r=>{late=r}) as never)
  await render({...venue,id:'b',name:'Venue B'});expect(node.textContent).not.toContain('₽ 290,00');expect(node.textContent).toContain('Загрузка')
  vi.mocked(apiGet).mockResolvedValueOnce({connection:{state:'not_connected'},all:null,app:null,unlinked:null,linkedRevenueSharePercent:null} as never)
  await render({...venue,id:'b',name:'Venue B'},'7 дней');await act(async()=>late(report))
  expect(node.textContent).toContain('Касса не подключена');expect(node.textContent).not.toContain('₽ 290,00');expect(node.textContent).toContain('Нет данных')
  expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/b/pos?days=7')
 })
 it('confirmed empty period is zero cash with unknown average, never an invented sale',async()=>{
  vi.mocked(apiGet).mockResolvedValueOnce({connection:{state:'connected',lastSuccessAt:'2026-10-02T12:00:00Z'},all:{...summary,salesCents:'0',returnsCents:'0',netCents:'0',averageCents:null,receiptCount:0,saleDocuments:0,returnDocuments:0}} as never)
  await render();expect(node.textContent).toContain('₽ 0,00');expect(node.textContent).toContain('Нет данных');expect(node.textContent).toContain('За период нет данных')
 })
})
