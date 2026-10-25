import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {SalesDashboard} from '../phaseC/SalesDashboard'
import {CashDashboard,type CashReport} from '../phaseC/CashDashboard'
import {validateCashRange} from '../phaseC/cash-period'
import {apiGet,type ApiVenue} from '../api'
vi.mock('../api',async()=>({...await vi.importActual('../api'),apiGet:vi.fn()}))
const venue:ApiVenue={id:'a',companyId:'company-a',companyName:'A',companyCode:'a',code:'a',name:'Venue A',address:null,legacyBarId:null}
const summary={salesCents:'1000',returnsCents:'1100',netCents:'-100',averageCents:'1000',receiptCount:1,saleDocuments:1,returnDocuments:1,days:[{label:'2026-10-01',amountCents:'1000'},{label:'2026-10-02',amountCents:'-1100'}],hours:[{label:'09',amountCents:'1000'},{label:'10',amountCents:'-1100'}],payments:[]}
const report:CashReport={connection:{state:'connected',lastSuccessAt:'2026-10-02T12:00:00Z'},all:summary}
let node:HTMLDivElement,root:Root
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.mocked(apiGet).mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node)})
afterEach(async()=>{await act(async()=>root.unmount());node.remove()})
function setInput(label:string,value:string){const input=node.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))}
async function submit(){await act(async()=>node.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
describe('cash custom interval and actual chart projections',()=>{
 it('validates inclusive leap-day, reversed, nonexistent, future and overlong ranges',()=>{
  expect(validateCashRange('2024-02-29','2024-03-01','2026-10-25')).toBe('')
  expect(validateCashRange('2026-10-01','2026-10-01','2026-10-25')).toBe('')
  for(const [a,b] of [['2026-02-29','2026-03-01'],['2026-10-05','2026-10-01'],['2026-10-01','2026-10-26'],['2024-01-01','2026-01-01']])expect(validateCashRange(a!,b!,'2026-10-25')).not.toBe('')
 })
 it('applies an exact range to the existing API, rejects invalid input and drops old reports on range errors',async()=>{
  vi.mocked(apiGet).mockResolvedValue(report as never)
  await act(async()=>root.render(createElement(SalesDashboard,{venue,days:30,mode:'all'})))
  await act(async()=>{setInput('Начало периода кассы','2026-10-01');setInput('Конец периода кассы','2026-10-02')})
  await submit();expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/a/pos?from=2026-10-01&to=2026-10-02')
  const count=vi.mocked(apiGet).mock.calls.length
  await act(async()=>{setInput('Начало периода кассы','2026-10-03');setInput('Конец периода кассы','2026-10-02')});await submit()
  expect(apiGet).toHaveBeenCalledTimes(count);expect(node.querySelector('[role=alert]')?.textContent).toContain('Начало периода')
  vi.mocked(apiGet).mockRejectedValueOnce(new Error('Range unavailable'))
  await act(async()=>{setInput('Начало периода кассы','2026-09-01');setInput('Конец периода кассы','2026-09-02')});await submit()
  expect(node.textContent).toContain('Range unavailable');expect(node.querySelector('.kpi-value')).toBeNull()
 })
 it('switches exact signed daily projections and 24-hour chart without changing totals',async()=>{
  await act(async()=>root.render(createElement(CashDashboard,{report})))
  const total=node.querySelector('.kpi-value')!.textContent
  expect(node.querySelectorAll('[data-cash-hour]')).toHaveLength(24)
  await act(async()=>{[...node.querySelectorAll('button')].find(x=>x.textContent==='По дням')!.click()})
  expect(node.querySelectorAll('[data-cash-hour]')).toHaveLength(0)
  expect(node.querySelectorAll('[data-cash-day]')).toHaveLength(2)
  expect(node.querySelector('[data-cash-day="2026-10-02"]')?.getAttribute('aria-label')).toContain('−₽ 11,00')
  expect(node.querySelector('.kpi-value')!.textContent).toBe(total)
  await act(async()=>{[...node.querySelectorAll('button')].find(x=>x.textContent==='По часам')!.click()})
  expect(node.querySelectorAll('[data-cash-hour]')).toHaveLength(24)
 })
})
