import { expect,test } from '@playwright/test'
const all={salesCents:'30000000',returnsCents:'1000000',netCents:'29000000',receiptCount:2,averageCents:'15000000',saleDocuments:2,returnDocuments:1,days:[{label:'2026-10-02',amountCents:'29000000'}],payments:[{label:'CASH',amountCents:'29000000'}]}
const report={period:{from:'2026-10-01T21:00:00Z',until:'2026-10-02T21:00:00Z',timeZone:'Europe/Moscow'},connection:{state:'connected',lastSuccessAt:'2026-10-02T12:00:00Z'},all,
 app:{...all,salesCents:'11000000',returnsCents:'1000000',netCents:'10000000',activeBuyers:1,repeatBuyers:0,repeatPurchaseRate:0,purchaseFrequency:1},
 unlinked:{...all,salesCents:'19000000',returnsCents:'0',netCents:'19000000'},linkedRevenueSharePercent:36.66}
test('actual dashboard: loading, all/client split, refresh, stale failure, auth loss, scope change, empty and disconnected',async({page},info)=>{
 let state='loading',release:()=>void=()=>{};const wait=new Promise<void>(r=>{release=r})
 await page.route('**/api/admin/venues/*/pos?days=*',async route=>{
  if(state==='loading')await wait
  if(state==='error')return route.fulfill({status:503,json:{error:'Fixture outage'}})
  if(state==='denied')return route.fulfill({status:403,json:{error:'Fixture scope denied'}})
  if(state==='disconnected')return route.fulfill({json:{connection:{state:'not_connected'},all:null,app:null,unlinked:null,linkedRevenueSharePercent:null}})
  if(state==='empty')return route.fulfill({json:{...report,all:{...all,salesCents:'0',returnsCents:'0',netCents:'0',receiptCount:0,averageCents:null,saleDocuments:0,returnDocuments:0,days:[],payments:[]},app:null,unlinked:null,linkedRevenueSharePercent:null}})
  return route.fulfill({json:report})
 })
 await page.goto('/e2e/fixtures/evotor.html');await expect(page.getByText('Загрузка кассовых документов…')).toBeVisible()
 state='normal';release();await expect(page.getByText('Внутри общей кассы')).toBeVisible()
 await expect(page.getByRole('button',{name:'Все продажи кассы',exact:true})).toHaveAttribute('aria-pressed','true')
 const money=page.locator('.kpi-value').first();await expect(money).toHaveText(/290\s*000,00/)
 await expect(page.getByText('Клиенты PIVNIK:',{exact:false})).toContainText(/110\s*000,00/)
 await expect(page.locator('body')).not.toContainText(/410\s*000,00/)
 await page.getByRole('button',{name:'Клиенты приложения',exact:true}).click();await expect(money).toHaveText(/100\s*000,00/)
 await expect(page.getByText('Частота покупок',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Все продажи кассы',exact:true}).click()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath('cash.png'),fullPage:true})
 state='error';await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(page.getByText(/Не обновлено/)).toBeVisible();await expect(money).toHaveText(/290\s*000,00/)
 state='denied';await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(page.getByText('Fixture scope denied')).toBeVisible();await expect(page.locator('.kpi-value')).toHaveCount(0)
 state='disconnected';await page.getByRole('button',{name:'Сменить заведение'}).click();await expect(page.getByText('Касса не подключена')).toBeVisible();await expect(money).toHaveText('Нет данных')
 state='empty';await page.getByRole('button',{name:'Обновить',exact:true}).click();await expect(money).toHaveText('₽ 0,00');await expect(page.getByText('За период нет данных')).toHaveCount(2)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
})
