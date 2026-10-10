import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe,expect,it } from 'vitest'
import { CashDashboard,type CashReport } from '../phaseC/CashDashboard'

const report:CashReport={connection:{state:'connected',lastSuccessAt:'2026-10-02T12:00:00Z'},all:{
  salesCents:'100001',returnsCents:'25001',netCents:'75000',averageCents:'50001',
  receiptCount:2,saleDocuments:2,returnDocuments:1,
  days:[{label:'2026-10-02',amountCents:'75000'}],payments:[{label:'CASH',amountCents:'75000'}],
}}
describe('cash register dashboard',()=>{
  it('does not turn missing, disabled or incomplete cash data into zeros or loyalty revenue',()=>{
    for(const value of [undefined,{...report,connection:{state:'not_connected'}},{...report,connection:{state:'syncing'}}]){
      const html=renderToStaticMarkup(createElement(CashDashboard,{report:value}))
      expect(html).toContain('Нет данных')
      expect(html).not.toContain('₽ 0,00')
      expect(html).not.toContain('₽ 750,00')
    }
  })
  it('shows the last full pass as ready data while the next pass runs',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report:{...report,connection:{...report.connection,state:'syncing'}}}))
    expect(html).toContain('Данные Эвотора')
    expect(html).toContain('₽ 750,00')
    expect(html).not.toContain('неполными')
    expect(html).toContain('на момент последней полной сверки')
  })
  it('shows cash sales/returns and operations without inventing customers',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report}))
    expect(html).toContain('₽ 750,00')
    expect(html).toContain('Операций')
    expect(html).toContain('Продажи за вычетом возвратов')
    expect(html).not.toContain('Повторных клиентов')
    expect(html).not.toContain('Клиентов всего')
    const unknown=renderToStaticMarkup(createElement(CashDashboard,{report:{...report,all:{...report.all!,receiptCount:null,averageCents:null}}}))
    expect(unknown).toContain('Нет данных')
  })
  it('keeps exact cents beyond floating-point precision and renders stale totals with a warning',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report:{...report,all:{...report.all!,netCents:'9007199254740993123',averageCents:'-1'},connection:{...report.connection,state:'error',errorCode:'network'}}}))
    expect(html).toContain('₽ 90\u00a0071\u00a0992\u00a0547\u00a0409\u00a0931,23')
    expect(html).toContain('−₽ 0,01')
    expect(html).toContain('Не удалось обновить кассу')
    expect(html).toContain('₽ 750,00')
  })
})
