import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe,expect,it } from 'vitest'
import { CashDashboard,type CashReport } from '../phaseC/CashDashboard'
import { isCashReport } from '../phaseC/cash-report'

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

  it('uses only already-synchronized POS hours and items, including returns and fractional quantities',()=>{
    const detailed:CashReport={...report,all:{...report.all!,
      hours:[{label:'09',amountCents:'75050'},{label:'10',amountCents:'-50'}],
      products:[
        {name:'Лагер <сезон>',measure:'л',quantityMillis:'1500',salesCents:'90001',returnCents:'25001',netCents:'65000'},
        {name:'Сидр',measure:'шт',quantityMillis:'1000',salesCents:'10000',returnCents:'0',netCents:'10000'},
      ],
    }}
    const html=renderToStaticMarkup(createElement(CashDashboard,{report:detailed}))
    expect(html).toContain('Выручка по часам')
    expect(html).toContain('09:00')
    expect(html).toContain('10:00')
    expect(html).toContain('−₽ 0,50')
    expect(html).toContain('Продажи по товарам')
    expect(html).toContain('Лагер &lt;сезон&gt;')
    expect(html).toContain('1,5 л')
    expect(html).toContain('₽ 650,00')
    expect(html.indexOf('Лагер &lt;сезон&gt;')).toBeLessThan(html.indexOf('Сидр'))
    expect(isCashReport(detailed)).toBe(true)
  })
  it('does not invent POS projections when they are unavailable or leak them into app-only view',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report}))
    expect(html).toContain('Нет данных о продажах по часам')
    expect(html).toContain('Нет данных о товарных позициях')
    const app=renderToStaticMarkup(createElement(CashDashboard,{report,mode:'app'}))
    expect(app).not.toContain('Выручка по часам')
    expect(app).not.toContain('Продажи по товарам')
    expect(html).not.toContain('₽ 0,00')
  })
  it('rejects malformed or inconsistent optional Evotor hour/product projections',()=>{
    const base=report.all!
    const valid={...report,all:{...base,hours:[{label:'09',amountCents:'-1'}],
      products:[{name:'Товар',measure:'шт',quantityMillis:'-500',salesCents:'100',returnCents:'200',netCents:'-100'}]}}
    expect(isCashReport(valid)).toBe(true)
    for(const bad of [
      {hours:[{label:'24',amountCents:'1'}]},
      {hours:[{label:'09',amountCents:'NaN'}]},
      {products:[{...valid.all.products[0],quantityMillis:'1.5'}]},
      {products:[{...valid.all.products[0],netCents:'100'}]},
      {products:[{...valid.all.products[0],measure:42}]},
    ])expect(isCashReport({...valid,all:{...valid.all,...bad}})).toBe(false)
  })

  it('keeps exact cents beyond floating-point precision and renders stale totals with a warning',()=>{
    const html=renderToStaticMarkup(createElement(CashDashboard,{report:{...report,all:{...report.all!,netCents:'9007199254740993123',averageCents:'-1'},connection:{...report.connection,state:'error',errorCode:'network'}}}))
    expect(html).toContain('₽ 90\u00a0071\u00a0992\u00a0547\u00a0409\u00a0931,23')
    expect(html).toContain('−₽ 0,01')
    expect(html).toContain('Не удалось обновить кассу')
    expect(html).toContain('₽ 750,00')
  })
})
