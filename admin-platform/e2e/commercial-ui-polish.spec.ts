import {expect,test,type Page} from '@playwright/test'
import fs from 'node:fs/promises'

const baseUrl=process.env.ADMIN_E2E_BASE_URL||''
const email=process.env.ADMIN_E2E_SUPER_EMAIL||''
const password=process.env.ADMIN_E2E_SUPER_PASSWORD||''
const out='artifacts/ui-polish'

async function login(page:Page){
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'})
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button',{name:'Войти'}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  const select=page.locator('.tenant-select')
  const option=select.locator('option').filter({hasText:'ПИВНИК'}).first()
  await expect(option).toHaveCount(1)
  const value=await option.getAttribute('value')
  if(value)await select.selectOption(value)
}

function guards(page:Page){
  const errors:string[]=[]
  const mutations:string[]=[]
  page.on('console',msg=>{if(msg.type()==='error')errors.push(`console:${msg.text()}`)})
  page.on('pageerror',error=>errors.push(`page:${error.message}`))
  page.on('requestfailed',request=>{if(request.url().startsWith(baseUrl))errors.push(`request:${request.url()}:${request.failure()?.errorText||''}`)})
  page.on('response',response=>{if(response.url().startsWith(baseUrl)&&response.status()>=400)errors.push(`http:${response.status()}:${response.url()}`)})
  page.on('request',request=>{
    if(!request.url().includes('/api/admin/'))return
    const method=request.method()
    if(method==='GET'||(method==='POST'&&request.url().endsWith('/api/admin/auth/login')))return
    mutations.push(`${method}:${request.url()}`)
  })
  return {errors,mutations}
}

async function noOverflow(page:Page){
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

async function openNav(page:Page,name:string){
  const mobile=page.locator('button.mobile-menu')
  if(await mobile.isVisible())await mobile.click()
  await page.locator('.sidebar').getByRole('button',{name,exact:true}).click()
}

async function shot(page:Page,name:string){
  await fs.mkdir(out,{recursive:true})
  await page.screenshot({path:`${out}/${name}.png`,fullPage:false})
}

test.describe('commercial Admin UI polish',()=>{
  test.skip(!baseUrl||!email||!password,'staging credentials required')

  test('desktop business surfaces are clear and read-only where expected',async({page})=>{
    await page.setViewportSize({width:1440,height:900})
    const g=guards(page)
    await login(page)
    await openNav(page,'Обзор')
    await expect(page.getByText('Начислено по программе',{exact:true})).toBeVisible()
    await expect(page.getByText('Списано клиентами',{exact:true})).toBeVisible()
    await expect(page.getByText('Бонусы в обращении',{exact:true})).toBeVisible()
    await expect(page.getByText(/Ручные персональные подарки не входят/)).toBeVisible()
    await noOverflow(page);await shot(page,'after-dashboard-1440')

    await openNav(page,'Клиенты')
    await expect(page.getByPlaceholder('Имя, @ник или ID клиента…')).toBeVisible()
    const first=page.locator('tbody tr').first();await expect(first).toBeVisible();await first.click()
    const drawer=page.locator('.drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('Последняя активность',{exact:true})).toBeVisible()
    await expect(drawer.getByText('Регистрация',{exact:true})).toBeVisible()
    await expect(drawer.getByText('Канал',{exact:true})).toBeVisible()
    await expect(drawer.getByText('Каналы и профили',{exact:true})).toBeVisible()
    await shot(page,'after-crm-client-1440')
    await page.getByRole('button',{name:'Закрыть карточку'}).click()

    await openNav(page,'Операции')
    await expect(page.getByText('Операций',{exact:true})).toBeVisible()
    await expect(page.locator('.bonus-flow').first()).toBeVisible()
    await shot(page,'after-operations-1440')

    await openNav(page,'Колесо')
    await expect(page.getByText('КОЛЕСО ФОРТУНЫ',{exact:true})).toBeVisible()
    await expect(page.getByText('Только просмотр',{exact:true})).toBeVisible()
    await expect(page.getByText('Вероятности настроены корректно',{exact:true})).toBeVisible()
    await expect(page.locator('.prize-row')).toHaveCount(7)
    await shot(page,'after-wheel-1440')

    await openNav(page,'Достижения')
    await expect(page.getByText('ДОСТИЖЕНИЯ ГОСТЕЙ',{exact:true})).toBeVisible()
    await expect(page.getByText('Только просмотр',{exact:true})).toBeVisible()
    await expect(page.locator('.achievement-card')).toHaveCount(21)
    await shot(page,'after-achievements-1440')

    await openNav(page,'Настройки')
    await expect(page.getByRole('heading',{name:'Настройки',exact:true}).first()).toBeVisible()
    await expect(page.getByText('Разделы приложения',{exact:true})).toBeVisible()
    await expect(page.getByText('Доступ из панели',{exact:true})).toBeVisible()
    await expect(page.getByText(/На controlled pilot изменение этих разделов/)).toBeVisible()
    await shot(page,'after-settings-1440')

    await noOverflow(page)
    expect(g.errors).toEqual([])
    expect(g.mutations).toEqual([])
  })

  for(const viewport of [
    {name:'1920',width:1920,height:1080},
    {name:'1366',width:1366,height:768},
    {name:'tablet',width:768,height:1024},
    {name:'mobile',width:390,height:844},
  ]){
    test(`responsive ${viewport.name} has no horizontal overflow`,async({page})=>{
      await page.setViewportSize({width:viewport.width,height:viewport.height})
      const g=guards(page)
      await login(page)
      await openNav(page,'Обзор')
      await expect(page.getByRole('heading',{name:/ПИВНИК/i}).first()).toBeVisible()
      await noOverflow(page)
      if(viewport.name==='1366'||viewport.name==='mobile')await shot(page,`after-dashboard-${viewport.name}`)
      await openNav(page,'Операции');await expect(page.getByRole('heading',{name:'Операции'})).toBeVisible();await noOverflow(page)
      await openNav(page,'Настройки');await expect(page.getByRole('heading',{name:'Настройки',exact:true}).first()).toBeVisible();await noOverflow(page)
      expect(g.errors).toEqual([])
      expect(g.mutations).toEqual([])
    })
  }
})
