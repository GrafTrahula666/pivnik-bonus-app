import {expect,test,type Page} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const superEmail=process.env.ADMIN_E2E_SUPER_EMAIL||''
const superPassword=process.env.ADMIN_E2E_SUPER_PASSWORD||''
const venueEmail=process.env.ADMIN_E2E_VENUE_EMAIL||''
const venuePassword=process.env.ADMIN_E2E_VENUE_PASSWORD||''
const northEmail=process.env.ADMIN_E2E_NORTH_EMAIL||''
const northPassword=process.env.ADMIN_E2E_NORTH_PASSWORD||''
const shot=path.resolve('artifacts/screenshots')

type Observation={consoleErrors:string[];pageErrors:string[];failedRequests:string[];badResponses:string[];reactWarnings:string[]}
type ApiResult={status:number;body:unknown;text:string}
type ApiVenue={id:string;companyId:string;companyName:string;name:string}

async function login(page:Page,email:string,password:string){
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.getByRole('heading',{name:'Вход в панель управления'})).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button',{name:'Войти'}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('.tenant-select option').first()).toBeAttached()
}

function observe(page:Page):Observation{
  const result:Observation={consoleErrors:[],pageErrors:[],failedRequests:[],badResponses:[],reactWarnings:[]}
  page.on('console',message=>{
    const location=message.location().url||''
    if(location.startsWith('chrome-extension://'))return
    if(message.type()==='error')result.consoleErrors.push(`${message.text()} @ ${location||'inline'}`)
    if(message.type()==='warning'&&/react|warning|recharts/i.test(message.text()))result.reactWarnings.push(message.text())
  })
  page.on('pageerror',error=>result.pageErrors.push(error.stack||error.message))
  page.on('requestfailed',request=>result.failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText||'unknown'}`))
  page.on('response',response=>{
    if(response.url().startsWith(String(process.env.ADMIN_E2E_BASE_URL||''))&&response.status()>=400){
      result.badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
    }
  })
  return result
}

function clean(result:Observation){
  expect(result.consoleErrors,`Console errors:\n${result.consoleErrors.join('\n')}`).toEqual([])
  expect(result.pageErrors,`Unhandled page errors:\n${result.pageErrors.join('\n')}`).toEqual([])
  expect(result.failedRequests,`Failed requests:\n${result.failedRequests.join('\n')}`).toEqual([])
  expect(result.badResponses,`Unexpected HTTP failures:\n${result.badResponses.join('\n')}`).toEqual([])
  expect(result.reactWarnings,`React warnings:\n${result.reactWarnings.join('\n')}`).toEqual([])
}

async function openNav(page:Page,name:string){
  const button=page.locator('.sidebar').getByRole('button',{name,exact:true})
  if(!await button.isVisible()){
    await page.locator('.mobile-menu').click()
    await expect(button).toBeVisible()
  }
  await button.click()
}

async function selectPivnik(page:Page){
  const select=page.locator('.tenant-select')
  const option=select.locator('option').filter({hasText:'ПИВНИК TEST · ПИВНИК TEST VENUE'})
  await expect(option).toHaveCount(1)
  await select.selectOption(await option.getAttribute('value')||'')
  await expect(select.locator('option:checked')).toContainText('ПИВНИК TEST VENUE')
}

async function pageReady(page:Page,title:string,ready?:string){
  await expect(page.getByRole('heading',{name:title,exact:true}).first()).toBeVisible()
  if(ready)await expect(page.locator(ready).first()).toBeVisible()
}

async function screenshot(page:Page,file:string){
  await page.screenshot({path:path.join(shot,file),fullPage:true})
}

async function api(page:Page,request:{path:string;method?:string;body?:unknown}):Promise<ApiResult>{
  return page.evaluate(async input=>{
    const method=input.method||'GET'
    const headers:Record<string,string>={}
    if(method!=='GET'&&method!=='HEAD'){
      const session=await fetch('/api/admin/auth/session',{credentials:'same-origin'}).then(response=>response.json())
      headers['content-type']='application/json'
      headers['x-csrf-token']=String(session.csrfToken||'')
    }
    const response=await fetch(input.path,{
      method,
      headers,
      credentials:'same-origin',
      body:input.body===undefined?undefined:JSON.stringify(input.body),
    })
    const text=await response.text()
    let body:unknown=text
    try{body=JSON.parse(text)}catch{/* non-JSON evidence remains text */}
    return {status:response.status,body,text}
  },request)
}

test.beforeAll(async()=>fs.mkdir(shot,{recursive:true}))

test('SUPER ADMIN full staging browser and visual flow',async({page})=>{
  test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
  test.setTimeout(180_000)
  await page.setViewportSize({width:1920,height:1080})
  const failures=observe(page)
  await login(page,superEmail,superPassword)

  await openNav(page,'Платформа')
  await pageReady(page,'Платформа','.platform-kpis')
  await screenshot(page,'01-super-admin-platform-dashboard.png')

  await openNav(page,'Компании')
  await pageReady(page,'Компании','tbody tr')
  await expect(page.locator('body')).toContainText('ПИВНИК TEST')
  await expect(page.locator('body')).toContainText('NORTH HOSPITALITY')
  await screenshot(page,'02-super-admin-companies.png')

  await openNav(page,'Заведения')
  await pageReady(page,'Заведения','.venue-card')
  await screenshot(page,'03-super-admin-venues.png')

  await selectPivnik(page)
  await openNav(page,'Обзор')
  await pageReady(page,'ПИВНИК TEST VENUE','.kpi-grid')
  await expect(page.locator('.admin-context')).toContainText('Главный администратор → ПИВНИК TEST → ПИВНИК TEST VENUE')
  await screenshot(page,'04-venue-dashboard.png')

  await openNav(page,'Аналитика')
  await pageReady(page,'Аналитика','.analytics-grid')
  await screenshot(page,'05-analytics.png')

  await openNav(page,'Клиенты')
  await pageReady(page,'Клиенты','tbody tr')
  await screenshot(page,'06-crm-customers.png')
  await page.locator('tbody tr').first().click()
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(page.locator('.drawer')).toContainText('КАРТОЧКА КЛИЕНТА')
  await expect(page.locator('.drawer .detail-grid')).toBeVisible()
  await screenshot(page,'07-customer-profile.png')
  await page.getByRole('button',{name:'Закрыть карточку'}).click()
  await expect(page.locator('.drawer')).toHaveCount(0)

  await openNav(page,'Лояльность')
  await pageReady(page,'Лояльность','.level-builder')
  await screenshot(page,'08-loyalty-constructor.png')

  await openNav(page,'Колесо')
  await pageReady(page,'Колесо','.prize-list')
  await expect(page.locator('.prob-total')).toContainText('100%')
  await screenshot(page,'09-wheel-constructor.png')

  await openNav(page,'Магазин')
  await pageReady(page,'Магазин','.shop-grid')
  await screenshot(page,'10-shop.png')

  await openNav(page,'Достижения')
  await pageReady(page,'Достижения','.achievement-grid')
  await screenshot(page,'11-achievements.png')

  await openNav(page,'Акции')
  await pageReady(page,'Акции','.promo-grid')
  await screenshot(page,'12-promotions.png')

  await openNav(page,'Оформление')
  await pageReady(page,'Оформление','.brand-layout')
  await screenshot(page,'13-branding.png')

  await openNav(page,'Настройки')
  await pageReady(page,'Настройки','.settings-grid')
  await openNav(page,'Журнал')
  await pageReady(page,'Журнал','tbody tr')

  await expect(page.locator('body')).not.toContainText(/CODEX|\bQA\b|offline runtime|implementation detail/i)
  clean(failures)
})

test('real customer bonus write reaches API, refreshed UI and Audit Log',async({page})=>{
  test.skip(process.env.ADMIN_E2E_ALLOW_BONUS_WRITE!=='true','Staging bonus write disabled')
  test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
  test.setTimeout(120_000)
  const failures=observe(page)
  await login(page,superEmail,superPassword)
  await selectPivnik(page)
  await openNav(page,'Клиенты')
  await pageReady(page,'Клиенты','tbody tr')
  await page.locator('tbody tr').first().click()
  await expect(page.locator('.drawer .detail-grid')).toBeVisible()
  const balance=page.locator('.drawer .detail').first()
  const before=await balance.textContent()

  await page.locator('.drawer').getByRole('button',{name:'Начислить',exact:true}).click()
  await page.getByLabel('Количество бонусов').fill('1')
  await page.getByLabel('Причина / комментарий').fill('Проверка обновления баланса в панели')
  await page.locator('.editor-modal').getByRole('button',{name:'Начислить',exact:true}).click()
  await expect(balance).not.toHaveText(before||'')

  await openNav(page,'Журнал')
  await pageReady(page,'Журнал','tbody tr')
  await expect(page.locator('tbody')).toContainText('Начисление бонусов')
  await expect(page.locator('tbody')).toContainText('Проверка обновления баланса в панели')
  clean(failures)
})

test('VENUE ADMIN A UI and HTTP tenant boundary reject every NORTH substitution',async({page})=>{
  test.skip(!venueEmail||!venuePassword||!superEmail||!superPassword,'Set staging credentials')
  test.setTimeout(120_000)
  await login(page,venueEmail,venuePassword)
  await expect(page.locator('.sidebar').getByRole('button',{name:'Платформа',exact:true})).toHaveCount(0)
  await expect(page.locator('.sidebar').getByRole('button',{name:'Компании',exact:true})).toHaveCount(0)

  const ownResponse=await api(page,{path:'/api/admin/venues'})
  expect(ownResponse.status).toBe(200)
  const ownVenues=(ownResponse.body as {venues:ApiVenue[]}).venues
  expect(ownVenues).toHaveLength(1)
  expect(ownVenues[0]?.companyName).toBe('ПИВНИК TEST')
  const own=ownVenues[0]!

  const platform=await api(page,{path:'/api/admin/platform'})
  expect(platform.status).toBe(403)

  await page.context().clearCookies()
  await login(page,superEmail,superPassword)
  const all=(await api(page,{path:'/api/admin/venues'})).body as {venues:ApiVenue[]}
  const north=all.venues.find(venue=>venue.companyName==='NORTH HOSPITALITY')
  expect(north,'Synthetic NORTH venue').toBeTruthy()

  for(const resource of [
    'dashboard?days=30','clients','operations','achievements','wheel','shop','promotions','design',
    'loyalty/manage','wheel/manage','achievements/manage','shop/manage','promotions/manage','branding/manage','features/manage','audit',
  ]){
    const superResult=await api(page,{path:`/api/admin/venues/${north!.id}/${resource}`})
    if(resource.startsWith('dashboard')||['clients','operations','achievements','wheel','shop','promotions','design'].includes(resource)){
      expect(superResult.status,`SUPER ADMIN reaches NORTH ${resource} authorization boundary`).toBe(409)
      expect((superResult.body as {code?:string}).code).toBe('LEGACY_ADAPTER_NOT_TENANT_SAFE')
    }else expect(superResult.status,`SUPER ADMIN reads NORTH ${resource}`).toBe(200)
  }

  await page.context().clearCookies()
  await login(page,venueEmail,venuePassword)
  for(const resource of [
    'dashboard?days=30','clients?companyId='+encodeURIComponent(north!.companyId),'operations?venueId='+encodeURIComponent(north!.id),
    'achievements','wheel','shop','promotions','design','loyalty/manage','wheel/manage','achievements/manage',
    'shop/manage','promotions/manage','branding/manage','features/manage','audit',
  ]){
    const denied=await api(page,{path:`/api/admin/venues/${north!.id}/${resource}`})
    expect([403,404],`VENUE ADMIN A denied NORTH ${resource}`).toContain(denied.status)
  }

  const bodyDenied=await api(page,{
    path:`/api/admin/venues/${north!.id}/loyalty/manage`,method:'PUT',
    body:{companyId:own.companyId,venueId:own.id,baseCashbackPercent:5,registrationBonus:100,referralBonus:100,levels:[]},
  })
  expect([403,404]).toContain(bodyDenied.status)

  const ownClients=await api(page,{path:`/api/admin/venues/${own.id}/clients?limit=1`})
  expect(ownClients.status).toBe(200)
  const ownCustomer=(ownClients.body as {rows:Array<{id:string}>}).rows[0]
  expect(ownCustomer).toBeTruthy()
  const forgedCustomer=await api(page,{path:`/api/admin/venues/${own.id}/clients/999999999`})
  expect([403,404]).toContain(forgedCustomer.status)

  await openNav(page,'Клиенты')
  await pageReady(page,'Клиенты','tbody tr')
  await openNav(page,'Лояльность');await pageReady(page,'Лояльность','.level-builder')
  await openNav(page,'Колесо');await pageReady(page,'Колесо','.prize-list')
  await openNav(page,'Достижения');await pageReady(page,'Достижения','.achievement-grid')
  await openNav(page,'Магазин');await pageReady(page,'Магазин','.shop-grid')
  await openNav(page,'Акции');await pageReady(page,'Акции','.promo-grid')
  await openNav(page,'Оформление');await pageReady(page,'Оформление','.brand-layout')
  await openNav(page,'Настройки');await pageReady(page,'Настройки','.settings-grid')
  await openNav(page,'Журнал');await pageReady(page,'Журнал','tbody tr')
})

test('NORTH VENUE ADMIN cannot navigate to PIVNIK by URL, query or body substitution',async({page})=>{
  test.skip(!northEmail||!northPassword||!superEmail||!superPassword,'Set staging credentials')
  await login(page,northEmail,northPassword)
  const own=(await api(page,{path:'/api/admin/venues'})).body as {venues:ApiVenue[]}
  expect(own.venues).toHaveLength(1)
  expect(own.venues[0]?.companyName).toBe('NORTH HOSPITALITY')
  await page.context().clearCookies()
  await login(page,superEmail,superPassword)
  const all=(await api(page,{path:'/api/admin/venues'})).body as {venues:ApiVenue[]}
  const foreign=all.venues.find(venue=>venue.companyName==='ПИВНИК TEST')
  expect(foreign).toBeTruthy()
  await page.context().clearCookies()
  await login(page,northEmail,northPassword)
  const denied=await api(page,{path:`/api/admin/venues/${foreign!.id}/clients?companyId=${own.venues[0]!.companyId}&venueId=${own.venues[0]!.id}`})
  expect([403,404]).toContain(denied.status)
  const bodyDenied=await api(page,{
    path:`/api/admin/venues/${foreign!.id}/features/manage`,method:'PUT',
    body:{companyId:own.venues[0]!.companyId,venueId:own.venues[0]!.id,wheelEnabled:true},
  })
  expect([403,404]).toContain(bodyDenied.status)
})

test('Demo Mode is synthetic and performs no production API mutations',async({page})=>{
  test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
  const failures=observe(page)
  const mutationRequests:string[]=[]
  page.on('request',request=>{
    if(request.url().includes('/api/admin/')&&!['GET','HEAD'].includes(request.method()))mutationRequests.push(`${request.method()} ${request.url()}`)
  })
  await page.setViewportSize({width:1440,height:900})
  await login(page,superEmail,superPassword)
  mutationRequests.length=0
  await page.getByRole('button',{name:'Демо',exact:true}).click()
  await expect(page.locator('.demo-watermark')).toContainText('ДЕМО-РЕЖИМ · ПРИМЕР ДАННЫХ · ИЗМЕНЕНИЯ НЕ СОХРАНЯЮТСЯ')
  await openNav(page,'Обзор')
  await expect(page.locator('.demo-mode-surface')).toBeVisible()
  await screenshot(page,'14-demo-mode.png')
  await openNav(page,'Колесо')
  await expect(page.locator('.demo-watermark')).toContainText('ПРИМЕР ДАННЫХ')
  expect(mutationRequests).toEqual([])
  clean(failures)
})

for(const [label,width,height,file] of [
  ['1920×1080',1920,1080,'16-responsive-1920x1080.png'],
  ['1440×900',1440,900,'17-responsive-1440x900.png'],
  ['1366×768',1366,768,'18-responsive-1366x768.png'],
  ['1024×768',1024,768,'19-responsive-1024.png'],
  ['tablet',768,1024,'20-tablet-dashboard.png'],
  ['mobile',390,844,'15-mobile-dashboard.png'],
] as const){
  test(`responsive ${label}`,async({page})=>{
    test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
    await page.setViewportSize({width,height})
    const failures=observe(page)
    await login(page,superEmail,superPassword)
    await selectPivnik(page)
    await openNav(page,'Обзор')
    await pageReady(page,'ПИВНИК TEST VENUE','.kpi-grid')
    await screenshot(page,file)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    clean(failures)
  })
}
