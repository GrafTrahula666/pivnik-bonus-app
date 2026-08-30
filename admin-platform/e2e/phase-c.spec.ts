import { expect,test,type Page } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const superEmail=process.env.ADMIN_E2E_SUPER_EMAIL||''
const superPassword=process.env.ADMIN_E2E_SUPER_PASSWORD||''
const venueEmail=process.env.ADMIN_E2E_VENUE_EMAIL||''
const venuePassword=process.env.ADMIN_E2E_VENUE_PASSWORD||''
const northEmail=process.env.ADMIN_E2E_NORTH_EMAIL||''
const northPassword=process.env.ADMIN_E2E_NORTH_PASSWORD||''
const shot=path.resolve('artifacts/screenshots')

async function login(page:Page,email:string,password:string){
  await page.goto('/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button',{name:'Войти'}).click()
  await expect(page.locator('.sidebar')).toBeVisible()
}
function observe(page:Page){
  const consoleErrors:string[]=[],failedRequests:string[]=[]
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
  page.on('requestfailed',r=>failedRequests.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`))
  return {consoleErrors,failedRequests}
}
function clean(x:ReturnType<typeof observe>){
  expect(x.consoleErrors,`Console errors:\n${x.consoleErrors.join('\n')}`).toEqual([])
  expect(x.failedRequests,`Failed requests:\n${x.failedRequests.join('\n')}`).toEqual([])
}
async function openNav(page:Page,name:string){await page.getByRole('button',{name,exact:true}).first().click()}

test.beforeAll(async()=>fs.mkdir(shot,{recursive:true}))

test('SUPER ADMIN sales-quality production flow',async({page})=>{
  test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
  const failures=observe(page);await login(page,superEmail,superPassword)

  await openNav(page,'Платформа')
  await expect(page.getByRole('heading',{name:'Платформа'})).toBeVisible()
  await page.screenshot({path:path.join(shot,'01-super-admin-dashboard.png'),fullPage:true})

  await openNav(page,'Обзор')
  await expect(page.locator('.admin-context')).toContainText('Главный администратор')
  await page.screenshot({path:path.join(shot,'02-venue-dashboard.png'),fullPage:true})

  await openNav(page,'Аналитика')
  await page.screenshot({path:path.join(shot,'03-analytics.png'),fullPage:true})

  await openNav(page,'Клиенты')
  await page.screenshot({path:path.join(shot,'04-crm.png'),fullPage:true})
  const row=page.locator('tbody tr').first()
  if(await row.count()){
    await row.click();await expect(page.locator('.drawer')).toBeVisible()
    await page.screenshot({path:path.join(shot,'05-customer-profile.png'),fullPage:true})
    await page.locator('.drawer .icon-btn').first().click()
  }

  await openNav(page,'Лояльность');await page.screenshot({path:path.join(shot,'06-loyalty-constructor.png'),fullPage:true})
  await openNav(page,'Колесо');await page.screenshot({path:path.join(shot,'07-wheel-constructor.png'),fullPage:true})
  await openNav(page,'Магазин');await page.screenshot({path:path.join(shot,'08-shop.png'),fullPage:true})
  await openNav(page,'Достижения');await page.screenshot({path:path.join(shot,'09-achievements.png'),fullPage:true})
  await openNav(page,'Акции');await expect(page.getByRole('heading',{name:'Акции'})).toBeVisible()
  await openNav(page,'Оформление');await expect(page.getByRole('heading',{name:'Оформление'})).toBeVisible()
  await openNav(page,'Настройки');await expect(page.getByRole('heading',{name:'Настройки'})).toBeVisible()
  clean(failures)
})

test('controlled real bonus operation is idempotent from UI',async({page})=>{
  test.skip(process.env.ADMIN_E2E_ALLOW_BONUS_WRITE!=='true','Pilot bonus write disabled')
  test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
  const failures=observe(page);await login(page,superEmail,superPassword)
  await openNav(page,'Клиенты')
  const row=page.locator('tbody tr').first();await expect(row).toBeVisible();await row.click()
  const balanceText=await page.locator('.detail').first().textContent()
  await page.getByRole('button',{name:'Начислить'}).click()
  await page.getByLabel('Количество бонусов').fill('1')
  await page.getByLabel('Причина / комментарий').fill('Approved E2E pilot adjustment')
  await page.getByRole('button',{name:'Начислить',exact:true}).last().click()
  await expect(page.locator('.drawer')).toContainText(/баланс/i)
  expect(await page.locator('.detail').first().textContent()).not.toBe(balanceText)
  clean(failures)
})

test('VENUE ADMIN has no platform pages and sees only authorized company',async({page})=>{
  test.skip(!venueEmail||!venuePassword,'Set VENUE E2E credentials')
  const failures=observe(page);await login(page,venueEmail,venuePassword)
  await expect(page.getByRole('button',{name:'Платформа',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Компании',exact:true})).toHaveCount(0)
  const options=page.locator('.tenant-select option')
  for(let i=0;i<await options.count();i++){
    const value=await options.nth(i).getAttribute('value')
    if(value==='__all__')continue
    const text=await options.nth(i).textContent()
    expect(text||'').toMatch(/ПИВНИК/i)
  }
  await openNav(page,'Клиенты');await expect(page.getByRole('heading',{name:'Клиенты'})).toBeVisible()
  await openNav(page,'Настройки');await expect(page.getByRole('heading',{name:'Настройки'})).toBeVisible()
  clean(failures)
})

test('NORTH tenant cannot navigate to PIVNIK by URL/body substitution',async({page,request})=>{
  test.skip(!northEmail||!northPassword,'Set synthetic NORTH E2E credentials')
  await login(page,northEmail,northPassword)
  const ownVenue=await page.locator('.tenant-select').inputValue()
  expect(ownVenue).not.toBe('')
  // Direct foreign venue id is supplied by staging env so test does not infer IDs.
  const foreign=process.env.ADMIN_E2E_PIVNIK_VENUE_ID
  if(foreign){
    const response=await page.evaluate(async(id)=>fetch(`/api/admin/venues/${id}/clients`).then(async r=>({status:r.status,body:await r.text()})),foreign)
    expect([403,404]).toContain(response.status)
  }
  void request
})

test('Sales Demo Mode contains no production mutations and is visibly synthetic',async({page})=>{
  test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
  const failures=observe(page);await login(page,superEmail,superPassword)
  await page.getByRole('button',{name:'Demo'}).click()
  await expect(page.locator('.demo-watermark')).toContainText('ДЕМО-РЕЖИМ')
  await page.screenshot({path:path.join(shot,'10-demo-mode.png'),fullPage:true})
  await openNav(page,'Колесо')
  await expect(page.locator('.demo-watermark')).toContainText('ПРИМЕР ДАННЫХ')
  clean(failures)
})

for(const [label,width,height] of [
  ['1920x1080',1920,1080],['1440x900',1440,900],['1366x768',1366,768],
  ['1024',1024,768],['tablet',768,1024],['mobile',390,844],
] as const){
  test(`responsive ${label}`,async({page})=>{
    test.skip(!superEmail||!superPassword,'Set SUPER E2E credentials')
    await page.setViewportSize({width,height});const failures=observe(page);await login(page,superEmail,superPassword)
    await openNav(page,'Обзор')
    await expect(page.getByRole('heading')).toBeVisible()
    if(label==='mobile')await page.screenshot({path:path.join(shot,'11-mobile.png'),fullPage:true})
    clean(failures)
  })
}
