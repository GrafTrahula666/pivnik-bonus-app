import {expect,test,type Browser,type BrowserContext,type Page} from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const baseUrl=process.env.ADMIN_E2E_BASE_URL||''
const superEmail=process.env.ADMIN_E2E_SUPER_EMAIL||''
const superPassword=process.env.ADMIN_E2E_SUPER_PASSWORD||''
const venueEmail=process.env.ADMIN_E2E_VENUE_EMAIL||''
const venuePassword=process.env.ADMIN_E2E_VENUE_PASSWORD||''
const northEmail=process.env.ADMIN_E2E_NORTH_EMAIL||''
const northPassword=process.env.ADMIN_E2E_NORTH_PASSWORD||''
const shot=path.resolve('artifacts/screenshots')

type StoredState=Awaited<ReturnType<BrowserContext['storageState']>>
type Observation={consoleErrors:string[];pageErrors:string[];failedRequests:string[];badResponses:string[];reactWarnings:string[]}
type ApiResult={status:number;body:unknown;text:string}
type ApiVenue={id:string;companyId:string;companyName:string;name:string}

let superState:StoredState|undefined
let venueState:StoredState|undefined
let northState:StoredState|undefined

async function authenticate(browser:Browser,email:string,password:string):Promise<StoredState>{
  const context=await browser.newContext({baseURL:baseUrl})
  const page=await context.newPage()
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.getByRole('heading',{name:'Вход в панель управления'})).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button',{name:'Войти'}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  const state=await context.storageState()
  await context.close()
  return state
}

async function sessionPage(browser:Browser,state:StoredState|undefined,viewport={width:1920,height:1080}){
  if(!state)throw new Error('E2E authenticated storage state is missing')
  const context=await browser.newContext({baseURL:baseUrl,storageState:state,viewport})
  const page=await context.newPage()
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('.tenant-select option').first()).toBeAttached()
  return {context,page}
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
    if(response.url().startsWith(baseUrl)&&response.status()>=400)result.badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
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

async function api(page:Page,request:{path:string;method?:string;body?:unknown}):Promise<ApiResult>{
  return page.evaluate(async input=>{
    const method=input.method||'GET'
    const headers:Record<string,string>={}
    if(method!=='GET'&&method!=='HEAD'){
      const session=await fetch('/api/admin/auth/session',{credentials:'same-origin'}).then(response=>response.json())
      headers['content-type']='application/json'
      headers['x-csrf-token']=String(session.csrfToken||'')
    }
    const response=await fetch(input.path,{method,headers,credentials:'same-origin',body:input.body===undefined?undefined:JSON.stringify(input.body)})
    const text=await response.text()
    let body:unknown=text
    try{body=JSON.parse(text)}catch{/* evidence remains text */}
    return {status:response.status,body,text}
  },request)
}

test.beforeAll(async({browser})=>{
  if(!baseUrl||!superEmail||!superPassword||!venueEmail||!venuePassword||!northEmail||!northPassword)throw new Error('Final staging proof credentials are incomplete')
  await fs.mkdir(shot,{recursive:true})
  superState=await authenticate(browser,superEmail,superPassword)
  venueState=await authenticate(browser,venueEmail,venuePassword)
  northState=await authenticate(browser,northEmail,northPassword)
})

test('01 SUPER ADMIN complete sales and management surface',async({browser})=>{
  test.setTimeout(180_000)
  const {context,page}=await sessionPage(browser,superState)
  const failures=observe(page)
  try{
    await openNav(page,'Платформа');await pageReady(page,'Платформа','.platform-kpis')
    await openNav(page,'Компании');await pageReady(page,'Компании','tbody tr')
    await expect(page.locator('body')).toContainText('ПИВНИК TEST')
    await expect(page.locator('body')).toContainText('NORTH HOSPITALITY')
    await openNav(page,'Заведения');await pageReady(page,'Заведения','.venue-card')
    await selectPivnik(page)
    await openNav(page,'Обзор');await pageReady(page,'ПИВНИК TEST VENUE','.kpi-grid')
    await openNav(page,'Аналитика');await pageReady(page,'Аналитика','.analytics-grid')
    await openNav(page,'Клиенты');await pageReady(page,'Клиенты','tbody tr')
    await page.locator('tbody tr').first().click()
    await expect(page.locator('.drawer .detail-grid')).toBeVisible()
    await page.getByRole('button',{name:'Закрыть карточку'}).click()
    await expect(page.locator('.drawer')).toHaveCount(0)
    await openNav(page,'Лояльность');await pageReady(page,'Лояльность','.level-builder')
    await openNav(page,'Колесо');await pageReady(page,'Колесо','.prize-list');await expect(page.locator('.prob-total')).toContainText('100%')
    await openNav(page,'Магазин');await pageReady(page,'Магазин','.shop-grid')
    await openNav(page,'Достижения');await pageReady(page,'Достижения','.achievement-grid')
    await openNav(page,'Акции');await pageReady(page,'Акции','.promo-grid')
    await openNav(page,'Оформление');await pageReady(page,'Оформление','.brand-layout')
    await openNav(page,'Настройки');await pageReady(page,'Настройки','.settings-grid')
    await openNav(page,'Журнал');await pageReady(page,'Журнал','tbody tr')
    await expect(page.locator('body')).not.toContainText(/CODEX|\bQA\b|offline runtime|implementation detail/i)
    clean(failures)
  }finally{await context.close()}
})

test('02 synthetic bonus write reaches DB, refreshed UI and Audit Log',async({browser})=>{
  test.setTimeout(90_000)
  const {context,page}=await sessionPage(browser,superState)
  const failures=observe(page)
  try{
    await selectPivnik(page)
    await openNav(page,'Клиенты');await pageReady(page,'Клиенты','tbody tr')
    await page.locator('tbody tr').first().click()
    await expect(page.locator('.drawer .detail-grid')).toBeVisible()
    const balance=page.locator('.drawer .detail').first()
    const before=await balance.textContent()
    await page.locator('.drawer').getByRole('button',{name:'Начислить',exact:true}).click()
    await page.getByLabel('Количество бонусов').fill('1')
    await page.getByLabel('Причина / комментарий').fill('Финальная E2E проверка баланса и аудита')
    await page.locator('.editor-modal').getByRole('button',{name:'Начислить',exact:true}).click()
    await expect(balance).not.toHaveText(before||'')
    await page.getByRole('button',{name:'Закрыть карточку'}).click()
    await expect(page.locator('.drawer')).toHaveCount(0)
    await openNav(page,'Журнал');await pageReady(page,'Журнал','tbody tr')
    await expect(page.locator('tbody')).toContainText('Начисление бонусов')
    await expect(page.locator('tbody')).toContainText('Финальная E2E проверка баланса и аудита')
    clean(failures)
  }finally{await context.close()}
})

test('03 PIVNIK VENUE ADMIN cannot cross into NORTH tenant',async({browser})=>{
  const ownSession=await sessionPage(browser,venueState)
  const superSession=await sessionPage(browser,superState)
  try{
    await expect(ownSession.page.locator('.sidebar').getByRole('button',{name:'Платформа',exact:true})).toHaveCount(0)
    const ownResponse=await api(ownSession.page,{path:'/api/admin/venues'})
    expect(ownResponse.status).toBe(200)
    const ownVenues=(ownResponse.body as {venues:ApiVenue[]}).venues
    expect(ownVenues).toHaveLength(1)
    expect(ownVenues[0]?.companyName).toBe('ПИВНИК TEST')
    expect((await api(ownSession.page,{path:'/api/admin/platform'})).status).toBe(403)
    const all=(await api(superSession.page,{path:'/api/admin/venues'})).body as {venues:ApiVenue[]}
    const north=all.venues.find(venue=>venue.companyName==='NORTH HOSPITALITY')
    expect(north).toBeTruthy()
    for(const resource of ['dashboard?days=30','clients','operations','achievements','wheel','shop','promotions','design','loyalty/manage','wheel/manage','achievements/manage','shop/manage','promotions/manage','branding/manage','features/manage','audit']){
      const denied=await api(ownSession.page,{path:`/api/admin/venues/${north!.id}/${resource}`})
      expect([403,404],`PIVNIK admin denied NORTH ${resource}`).toContain(denied.status)
    }
    const bodyDenied=await api(ownSession.page,{path:`/api/admin/venues/${north!.id}/loyalty/manage`,method:'PUT',body:{companyId:ownVenues[0]!.companyId,venueId:ownVenues[0]!.id,baseCashbackPercent:5,registrationBonus:100,referralBonus:100,levels:[]}})
    expect([403,404]).toContain(bodyDenied.status)
  }finally{await ownSession.context.close();await superSession.context.close()}
})

test('04 NORTH VENUE ADMIN cannot cross into PIVNIK tenant',async({browser})=>{
  const northSession=await sessionPage(browser,northState)
  const superSession=await sessionPage(browser,superState)
  try{
    const own=(await api(northSession.page,{path:'/api/admin/venues'})).body as {venues:ApiVenue[]}
    expect(own.venues).toHaveLength(1)
    expect(own.venues[0]?.companyName).toBe('NORTH HOSPITALITY')
    const all=(await api(superSession.page,{path:'/api/admin/venues'})).body as {venues:ApiVenue[]}
    const pivnik=all.venues.find(venue=>venue.companyName==='ПИВНИК TEST')
    expect(pivnik).toBeTruthy()
    const denied=await api(northSession.page,{path:`/api/admin/venues/${pivnik!.id}/clients?companyId=${own.venues[0]!.companyId}&venueId=${own.venues[0]!.id}`})
    expect([403,404]).toContain(denied.status)
    const bodyDenied=await api(northSession.page,{path:`/api/admin/venues/${pivnik!.id}/features/manage`,method:'PUT',body:{companyId:own.venues[0]!.companyId,venueId:own.venues[0]!.id,wheelEnabled:true}})
    expect([403,404]).toContain(bodyDenied.status)
  }finally{await northSession.context.close();await superSession.context.close()}
})

test('05 Demo Mode performs zero Admin API mutations',async({browser})=>{
  const {context,page}=await sessionPage(browser,superState,{width:1440,height:900})
  const failures=observe(page)
  const mutations:string[]=[]
  page.on('request',request=>{if(request.url().includes('/api/admin/')&&!['GET','HEAD'].includes(request.method()))mutations.push(`${request.method()} ${request.url()}`)})
  try{
    await page.getByRole('button',{name:'Демо',exact:true}).click()
    await expect(page.locator('.demo-watermark')).toContainText('ДЕМО-РЕЖИМ · ПРИМЕР ДАННЫХ · ИЗМЕНЕНИЯ НЕ СОХРАНЯЮТСЯ')
    await openNav(page,'Обзор');await expect(page.locator('.demo-mode-surface')).toBeVisible()
    await openNav(page,'Колесо');await expect(page.locator('.demo-watermark')).toContainText('ПРИМЕР ДАННЫХ')
    expect(mutations).toEqual([])
    clean(failures)
  }finally{await context.close()}
})

for(const [number,label,width,height] of [
  ['06','1920×1080',1920,1080],['07','1440×900',1440,900],['08','1366×768',1366,768],
  ['09','1024×768',1024,768],['10','tablet 768×1024',768,1024],['11','mobile 390×844',390,844],
] as const){
  test(`${number} responsive ${label}`,async({browser})=>{
    const {context,page}=await sessionPage(browser,superState,{width,height})
    const failures=observe(page)
    try{
      await selectPivnik(page)
      await openNav(page,'Обзор');await pageReady(page,'ПИВНИК TEST VENUE','.kpi-grid')
      await page.screenshot({path:path.join(shot,`final-proof-${number}.png`),fullPage:true})
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
      clean(failures)
    }finally{await context.close()}
  })
}
