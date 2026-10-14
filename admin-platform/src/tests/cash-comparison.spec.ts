import { act,createElement } from 'react'
import { createRoot,type Root } from 'react-dom/client'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { CashComparison } from '../phaseC/CashComparison'
import { ApiError,apiGet } from '../api'
import type { CashReport } from '../phaseC/cash-report'
vi.mock('../api',async()=>({...await vi.importActual('../api'),apiGet:vi.fn()}))
const summary={salesCents:'10000',returnsCents:'1000',netCents:'9000',averageCents:'5000',receiptCount:2,saleDocuments:2,returnDocuments:1,days:[],payments:[]}
const current:CashReport={period:{from:'2026-10-03T21:00:00Z',until:'2026-10-10T21:00:00Z',timeZone:'Europe/Moscow'},connection:{state:'connected',lastSuccessAt:'2026-10-11T01:00:00Z'},all:summary,app:{...summary,salesCents:'2000',returnsCents:'0',netCents:'2000',averageCents:'1000',returnDocuments:0}}
const previous:CashReport={...current,all:{...summary,salesCents:'4000',returnsCents:'0',netCents:'4000',averageCents:'2000',returnDocuments:0},app:{...summary,salesCents:'1000',returnsCents:'0',netCents:'1000',averageCents:'500',returnDocuments:0}}
let node:HTMLDivElement,root:Root
async function render(report=current,mode:'all'|'app'='all',venueId='a',unavailable=false){await act(async()=>root.render(createElement(CashComparison,{report,mode,venueId,unavailable,key:venueId})))}
async function enable(){await act(async()=>node.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())}
async function button(label:string){await act(async()=>[...node.querySelectorAll('button')].find(b=>b.textContent===label)!.click())}
async function change(selector:string,value:string){await act(async()=>{const input=node.querySelector<HTMLInputElement|HTMLSelectElement>(selector)!;const prototype=input instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event(input instanceof HTMLSelectElement?'change':'input',{bubbles:true}))})}
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.mocked(apiGet).mockReset();node=document.createElement('div');document.body.append(node);root=createRoot(node)})
afterEach(async()=>{await act(async()=>root.unmount());node.remove()})
describe('cash comparison of real report projections',()=>{
 it('requests the adjacent equal Moscow period only when enabled, switches all three metrics and the app cohort',async()=>{
  vi.mocked(apiGet).mockResolvedValue(previous as never);await render();expect(apiGet).not.toHaveBeenCalled()
  await enable();expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/a/pos?from=2026-09-27&to=2026-10-03')
  expect(node.textContent).toContain('04.10.2026 — 10.10.2026');expect(node.textContent).toContain('27.09.2026 — 03.10.2026')
  expect(node.querySelector('.cash-comparison-delta')?.textContent).toContain('+₽ 50,00');expect(node.textContent).toContain('+125%')
  await button('Средний чек');expect(node.querySelector('.cash-comparison-delta')?.textContent).toContain('+₽ 30,00')
  await button('Операции');expect(node.querySelector('.cash-comparison-delta')?.textContent).toContain('+1');expect(node.textContent).toContain('+50%')
  await render(current,'app');await button('Выручка');expect(node.querySelector('.cash-comparison-delta')?.textContent).toContain('+₽ 10,00')
  expect(apiGet).toHaveBeenCalledTimes(1)
 })
 it('applies a custom inclusive date range, rejects invalid drafts and removes prior bars on errors and late results',async()=>{
  vi.mocked(apiGet).mockResolvedValueOnce(previous as never);await render();await enable()
  await change('select','custom');await change('[aria-label="Начало периода сравнения"]','2026-09-01');await change('[aria-label="Конец периода сравнения"]','2026-09-07')
  expect(apiGet).toHaveBeenCalledTimes(1)
  let late!:(value:unknown)=>void;vi.mocked(apiGet).mockImplementationOnce(()=>new Promise(r=>{late=r}) as never)
  await button('Применить');expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/a/pos?from=2026-09-01&to=2026-09-07')
  expect(node.querySelector('.cash-comparison-chart')).toBeNull()
  await change('[aria-label="Начало периода сравнения"]','2026-09-08');await button('Применить');expect(apiGet).toHaveBeenCalledTimes(2);expect(node.textContent).toContain('от 1 до 366')
  await change('[aria-label="Начало периода сравнения"]','2026-09-02')
  vi.mocked(apiGet).mockRejectedValueOnce(new ApiError(403,'SCOPE','Comparison denied'));await button('Применить');await act(async()=>late(previous))
  expect(node.textContent).toContain('Comparison denied');expect(node.querySelector('.cash-comparison-chart')).toBeNull()
  vi.mocked(apiGet).mockResolvedValueOnce(previous as never);await button('Повторить сравнение');expect(node.querySelector('.cash-comparison-chart')).toBeTruthy()
 })
 it('handles zero bases, missing average, negative cash and exact very large cent values without false percentages',async()=>{
  const zero={...previous,app:null,all:{...summary,salesCents:'0',returnsCents:'0',netCents:'0',averageCents:null,receiptCount:0,saleDocuments:0,returnDocuments:0}}
  vi.mocked(apiGet).mockResolvedValue(zero as never);await render();await enable();expect(node.textContent).toContain('Нет базы для %');expect(node.textContent).not.toContain('Infinity')
  await button('Средний чек');expect(node.textContent).toContain('Сравнение недоступно');expect(node.textContent).toContain('Нет данных')
  for(const bar of node.querySelectorAll<HTMLElement>('.cash-comparison-bar'))expect(parseFloat(bar.style.width)).toBeLessThanOrEqual(100)
  await render({...current,app:null,all:{...summary,salesCents:'0',returnsCents:'50',netCents:'-50'}});await button('Выручка')
  expect(node.textContent).toContain('−₽ 0,50');expect(node.querySelector('.cash-comparison-bar.negative')).toBeTruthy()
  await render({...current,all:{...summary,salesCents:'9007199254740993123',returnsCents:'0',netCents:'9007199254740993123'}})
  expect(node.textContent).toContain('90\u00a0071\u00a0992\u00a0547\u00a0409\u00a0931,23')
 })
 it('does not compare stale current data or retain another venue on a failed request',async()=>{
  vi.mocked(apiGet).mockResolvedValueOnce(previous as never);await render();await enable();expect(node.querySelector('.cash-comparison-chart')).toBeTruthy()
  await render(current,'all','a',true);expect(node.querySelector('.cash-comparison-chart')).toBeNull();expect(node.textContent).toContain('Обновите основной отчёт')
  vi.mocked(apiGet).mockRejectedValueOnce(new Error('Other venue failed'));await render(current,'all','b');expect(node.querySelector('input')?.checked).toBe(false)
  await enable();expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/b/pos?from=2026-09-27&to=2026-10-03');expect(node.textContent).toContain('Other venue failed');expect(node.querySelector('.cash-comparison-chart')).toBeNull()
 })
 it('explains a failed cash sync separately from genuinely missing comparison data',async()=>{
  vi.mocked(apiGet).mockResolvedValueOnce({...previous,connection:{state:'error',lastSuccessAt:'2026-10-11T01:00:00Z'}} as never)
  await render();await enable()
  expect(node.querySelector('.cash-comparison-delta')?.textContent).toContain('ошибка синхронизации кассы')
  expect(node.querySelector('.cash-comparison-delta')?.textContent).not.toContain('недостаточно данных')
  expect(node.querySelector('.cash-comparison-chart')?.textContent).toContain('Нет данных')
  vi.mocked(apiGet).mockResolvedValueOnce({...previous,connection:{state:'error',lastSuccessAt:null}} as never)
  await render(current,'all','b');await enable()
  expect(node.querySelector('.cash-comparison-delta')?.textContent).toContain('недостаточно данных')
  expect(node.querySelector('.cash-comparison-delta')?.textContent).not.toContain('ошибка синхронизации')
 })

})
