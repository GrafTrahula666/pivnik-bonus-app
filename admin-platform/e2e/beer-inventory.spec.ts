import {expect,test} from '@playwright/test'
import {projectBeerInventory,type BeerDocument,type BeerMovement} from '../server/beer-inventory-model'
const product={productId:'product-verified-id',name:'Жигулёвское',measure:'л',supported:true,baseline:null,balanceMillis:null,deliveredMillis:'0',soldMillis:'0',writtenOffMillis:'0',returnedMillis:'0',soldTodayMillis:'8500',soldPeriodMillis:'8500',warnings:[],status:'uninitialized',history:[],historyTruncated:false,refunds:[]}
test('CRM beer: initial/delivery/spill, lost reply recovery, incomplete data and foreign scope',async({page},info)=>{
 await page.clock.install({time:new Date('2026-10-26T12:00:00Z')})
 let current={...product} as Record<string,unknown>,lost=true,denied=false;const bodies:Record<string,unknown>[]=[]
 const report=()=>({source:'crm_calculated',storeId:'store-a',asOf:'2026-10-26T12:00:00Z',writeEnabled:true,products:[current],quality:{lastSuccessfulHistorySyncAt:'2026-10-26T11:55:00Z',coveredUntil:'2026-10-26T11:54:00Z',historyComplete:true,historyCursorPending:false,errorCode:null,unknownPositions:0,stale:false,recentSync:{state:'not_recorded'}}})
 await page.route('**/api/admin/venues/*/beer-inventory**',async route=>{
  if(denied)return route.fulfill({status:403,json:{code:'SCOPE_DENIED',error:'Fixture foreign scope denied'}})
  if(route.request().method()==='GET')return route.fulfill({json:report()})
  const b=route.request().postDataJSON() as Record<string,unknown>;bodies.push(b)
  if(b.kind==='initial')current={...current,baseline:{operationId:b.operationId,kind:'initial',quantityMillis:b.quantityMillis,effectiveAt:'2026-10-26T12:00:00Z'},balanceMillis:b.quantityMillis,status:'pending'}
  if(b.kind==='delivery'&&lost){lost=false;current={...current,balanceMillis:'80000',deliveredMillis:'50000'};return route.abort('connectionreset')}
  return route.fulfill({json:{ok:true,source:'crm_calculated',operationId:b.operationId,alreadyApplied:b.kind==='delivery'}})
 })
 await page.goto('/e2e/fixtures/beer-inventory.html')
 await expect(page.getByRole('heading',{name:'Остатки пива',exact:true})).toBeVisible()
 await expect(page.getByRole('tab',{name:/На учёте/})).toHaveAttribute('aria-selected','true')
 await page.getByRole('button',{name:'Выбрать товар',exact:true}).click()
 await expect(page.getByText('Нет начального остатка',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Начать учёт',exact:true}).click()
 await page.getByLabel('Фактически, л',{exact:true}).fill('30')
 await page.getByRole('button',{name:'Сохранить',exact:true}).click()
 expect(bodies[0]?.quantityMillis).toBe('30000');expect(bodies[0]).not.toHaveProperty('storeId')
 await expect(page.getByText('Ожидается синхронизация',{exact:true})).toBeVisible()
 await expect(page.getByRole('tab',{name:/На учёте/})).toHaveAttribute('aria-selected','true')
 await page.getByRole('button',{name:'Привоз',exact:true}).click()
 await page.getByLabel('Количество, л',{exact:true}).fill('50')
 await page.getByLabel('Накладная (необязательно)').fill('TEST-1')
 await page.getByRole('button',{name:'Добавить привоз',exact:true}).click()
 await expect(page.getByRole('button',{name:'Проверить сохранение'})).toBeVisible()
 await page.reload()
 await page.getByRole('button',{name:'Проверить сохранение'}).click()
 await expect(page.getByText('Операция уже сохранена. Повторного движения нет.')).toBeVisible()
 expect(bodies[1]).toEqual(bodies[2])
 await page.getByRole('button',{name:'Списание',exact:true}).click()
 await page.getByLabel('Количество, л',{exact:true}).fill('1,5')
 await page.getByLabel('Комментарий',{exact:true}).fill('Пролив')
 await expect(page.getByRole('button',{name:'Сохранить',exact:true})).toBeDisabled()
 await page.getByLabel('Этот расход ещё не отражён в кассовых чеках').check()
 await expect(page.getByRole('button',{name:'Сохранить',exact:true})).toBeEnabled()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath('beer-inventory.png'),fullPage:true})
 denied=true;await page.getByRole('button',{name:'Сменить заведение'}).click()
 await expect(page.getByRole('alert')).toHaveText('Fixture foreign scope denied')
 await expect(page.getByText('Жигулёвское',{exact:true})).toHaveCount(0)
})

test('On hand: saved liters, actual receipt deduction, low stock, refresh and all-products separation',async({page},info)=>{
 await page.clock.install({time:new Date('2026-10-26T12:00:00Z')})
 const base:BeerMovement={operationId:'base-a',sequence:'1',productId:'beer-a',kind:'initial',quantityMillis:'30000',baselineId:null,effectiveAt:'2026-10-26T10:00:00Z',recordedAt:'2026-10-26T10:00:00Z',actorId:'owner',note:'Фактически 30 л',invoice:'',reason:'',returnDocumentId:null,evidence:{}}
 const movements:BeerMovement[]=[base,{...base,operationId:'base-b',sequence:'2',productId:'beer-b',quantityMillis:'8000'}]
 const documents:BeerDocument[]=[
  {storeId:'store-a',documentId:'older',type:'SELL',closedAt:'2026-10-26T09:00:00Z',baseDocumentId:null,positions:[{productId:'beer-a',name:'Шумерское',measure:'л',quantityMillis:5000},{productId:'beer-b',name:'Светлое',measure:'л',quantityMillis:1000},{productId:'beer-c',name:'Ещё не внесено',measure:'л',quantityMillis:1000}]},
  {storeId:'store-a',documentId:'sale-a',type:'SELL',closedAt:'2026-10-26T11:00:00Z',baseDocumentId:null,positions:[{productId:'beer-a',name:'Шумерское',measure:'л',quantityMillis:2500}]}
 ]
 let gets=0,posts=0
 await page.route('**/api/admin/venues/*/beer-inventory**',async route=>{
  if(route.request().method()!=='GET'){posts++;return route.fulfill({status:400,json:{error:'Unexpected write'}})}
  gets++
  return route.fulfill({json:{...projectBeerInventory({storeId:'store-a',documents,movements,sync:{lastSuccessAt:'2026-10-26T12:00:00Z',scanUntil:'2026-10-26T12:00:00Z',cursor:null,errorCode:null},asOf:'2026-10-26T12:00:00Z',now:'2026-10-26T12:00:00Z',periodFrom:'2026-10-25T21:00:00Z',periodUntil:'2026-10-26T12:00:00Z'}),storeId:'store-a',writeEnabled:true}})
 })
 await page.goto('/e2e/fixtures/beer-inventory.html')
 const table=page.getByRole('table',{name:'Пиво на учёте',exact:true}),row=table.getByRole('row').filter({hasText:'Шумерское'})
 await expect(table.getByRole('row')).toHaveCount(3)
 await expect(page.getByText('Ещё не внесено',{exact:true})).toHaveCount(0)
 await expect(row.locator('[data-label="Зафиксировано"]')).toContainText('30 л')
 await expect(row.locator('[data-label="Вычтено продажами"]')).toContainText('2,5 л')
 await expect(row.locator('[data-label="Осталось"] strong')).toHaveText('27,5 л')
 await expect(row.locator('[data-label="Учёт продаж"]')).toContainText('Загруженные продажи вычитаются')
 await expect(table.getByRole('row').nth(1)).toContainText('Светлое')
 documents.push({...documents[1]!,documentId:'sale-b',closedAt:'2026-10-26T11:30:00Z',positions:[{productId:'beer-a',name:'Шумерское',measure:'л',quantityMillis:20500}]})
 await page.getByRole('button',{name:'Обновить',exact:true}).click()
 await expect(row.locator('[data-label="Осталось"] strong')).toHaveText('7 л')
 await expect(row).toContainText('Заканчивается · пора заказать')
 await expect(table.getByRole('row').nth(1)).toContainText('Шумерское')
 const before=gets;await page.clock.fastForward(120000);await expect.poll(()=>gets).toBeGreaterThan(before)
 await expect(row.locator('[data-label="Осталось"] strong')).toHaveText('7 л')
 await page.getByRole('tab',{name:/На учёте/}).focus();await page.keyboard.press('ArrowRight')
 await expect(page.getByRole('tab',{name:/Все товары/})).toBeFocused()
 await expect(page.getByText('Ещё не внесено',{exact:true})).toBeVisible()
 await page.getByRole('tab',{name:/На учёте/}).click()
 await page.getByLabel('Остаток ≤ 10 л').check()
 await expect(table.getByRole('row')).toHaveCount(3)
 expect(posts).toBe(0)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await page.screenshot({path:info.outputPath('beer-on-hand.png'),fullPage:true})
})

test('On hand keeps zero and unsupported tracked stock visible with a warning',async({page})=>{
 await page.clock.install({time:new Date('2026-10-26T12:00:00Z')})
 const products=[
  {...product,productId:'zero',name:'Закончился сорт',baseline:{kind:'count',quantityMillis:'0',effectiveAt:'2026-10-26T10:00:00Z'},balanceMillis:'0',status:'pending'},
  {...product,productId:'bad',name:'Проверить единицы',baseline:{kind:'initial',quantityMillis:'30000',effectiveAt:'2026-10-26T10:00:00Z'},balanceMillis:'30000',supported:false,status:'incomplete',warnings:['Единица измерения не подтверждена как литры.']}
 ]
 await page.route('**/api/admin/venues/*/beer-inventory**',route=>route.fulfill({json:{source:'crm_calculated',storeId:'store-a',asOf:'2026-10-26T12:00:00Z',writeEnabled:true,products,quality:{lastSuccessfulHistorySyncAt:null,coveredUntil:null,historyComplete:false,historyCursorPending:true,errorCode:null,unknownPositions:0,stale:true,recentSync:{state:'not_recorded'}}}}))
 await page.goto('/e2e/fixtures/beer-inventory.html')
 const table=page.getByRole('table',{name:'Пиво на учёте',exact:true})
 await expect(table.getByRole('row')).toHaveCount(3)
 await expect(table.getByRole('row').filter({hasText:'Закончился сорт'})).toContainText('Закончился · проверьте остаток')
 const row=table.getByRole('row').filter({hasText:'Проверить единицы'})
 await expect(row).toContainText('Продажи учитываются не полностью')
 await expect(row.getByRole('button',{name:'Привоз',exact:true})).toBeDisabled()
 await expect(page.getByRole('tab',{name:/На учёте/})).toHaveText('На учёте2')
})
