import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe,it,expect } from 'vitest'
import { CashDashboard,type CashReport } from '../phaseC/CashDashboard'
import { isCashReport } from '../phaseC/cash-report'
const base={salesCents:'30000',returnsCents:'1000',netCents:'29000',receiptCount:2,averageCents:'15000',saleDocuments:2,returnDocuments:1,days:[],payments:[]}
const report:CashReport={connection:{state:'connected',lastSuccessAt:'2026-10-02T12:00:00Z'},all:base,
  app:{...base,salesCents:'11000',returnsCents:'1000',netCents:'10000',saleDocuments:1,activeBuyers:1,repeatBuyers:0,repeatPurchaseRate:0,purchaseFrequency:1},
  unlinked:{...base,salesCents:'19000',returnsCents:'0',netCents:'19000'},linkedRevenueSharePercent:36.66}
describe('cash cohorts never create another revenue source',()=>{
  it('shows all cash as 290, not 290 plus 100; split is visibly inside it',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report}))
    expect(html).toContain('₽ 290,00');expect(html).not.toContain('₽ 390,00')
    expect(html).toContain('Внутри общей кассы');expect(html).toContain('₽ 110,00');expect(html).toContain('₽ 190,00')
    expect(html).not.toContain('Повторных покупателей')
  })
  it('client cohort uses only linked cash with CRM and subset explanation',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report,mode:'app'}))
    expect(html).toContain('₽ 100,00');expect(html).not.toContain('₽ 290,00');expect(html).toContain('Это часть общей кассы')
    expect(html).toContain('Повторные покупки');expect(html).toContain('Частота покупок')
  })
  it('keeps previous confirmed data visibly stale, but validates malformed transport and subset conflicts',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report,error:'Временная ошибка'}))
    expect(html).toContain('₽ 290,00');expect(html).toContain('Не обновлено')
    expect(isCashReport({})).toBe(false);expect(isCashReport(null)).toBe(false)
    for(const patch of [{averageCents:'not money'},{receiptCount:-1},{days:[{label:'day',amountCents:'1.2'}]},{netCents:'30000'}])expect(isCashReport({...report,all:{...base,...patch}})).toBe(false)
    expect(isCashReport({...report,unlinked:{...report.unlinked,salesCents:'29000',netCents:'29000'}})).toBe(false)
    expect(isCashReport(report)).toBe(true)
    expect(isCashReport({...report,app:{...report.app,salesCents:'99999'}})).toBe(false)
  })
})
