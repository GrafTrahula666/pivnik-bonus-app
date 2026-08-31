import {expect,test,type Page} from '@playwright/test'

const baseUrl=process.env.ADMIN_E2E_BASE_URL||''
const email=process.env.ADMIN_E2E_SUPER_EMAIL||''
const password=process.env.ADMIN_E2E_SUPER_PASSWORD||''

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

function installRuntimeGuards(page:Page){
  const errors:string[]=[]
  page.on('console',msg=>{if(msg.type()==='error')errors.push(`console:${msg.text()}`)})
  page.on('pageerror',error=>errors.push(`page:${error.message}`))
  page.on('requestfailed',request=>{if(request.url().startsWith(baseUrl))errors.push(`request:${request.url()}:${request.failure()?.errorText||''}`)})
  page.on('response',response=>{if(response.url().startsWith(baseUrl)&&response.status()>=400)errors.push(`http:${response.status()}:${response.url()}`)})
  return errors
}

async function assertWheel(page:Page){
  await expect(page.getByRole('heading',{name:'Колесо'})).toBeVisible()
  await expect(page.getByText('РАБОЧАЯ КОНФИГУРАЦИЯ')).toBeVisible()
  await expect(page.getByText('100%',{exact:true})).toBeVisible()
  await expect(page.locator('.prize-row')).toHaveCount(7)
  await expect(page.getByText('5 бонусов',{exact:true})).toBeVisible()
  await expect(page.getByText('100 бонусов',{exact:true})).toBeVisible()
  await expect(page.getByText('Бокал пива',{exact:true})).toBeVisible()
  await expect(page.getByText('Годовой запас пива',{exact:true}).first()).toBeVisible()
  const stats=page.locator('.mini-stats > div')
  await expect(stats).toHaveCount(3)
  await expect(stats.nth(0)).toContainText('24 ч')
  await expect(stats.nth(1)).toContainText('50')
  await expect(stats.nth(2)).toContainText('100')
  await expect(page.getByText('Редактирование намеренно отключено')).toBeVisible()
  await expect(page.getByRole('button',{name:/сохранить/i})).toHaveCount(0)
}

async function assertAchievements(page:Page){
  await expect(page.getByRole('heading',{name:'Достижения'})).toBeVisible()
  await expect(page.getByText('РАБОЧИЙ КАТАЛОГ')).toBeVisible()
  await expect(page.locator('.achievement-card')).toHaveCount(21)
  for(const title of ['Первый тост','Король месяца','Тестировщик','Создатель','Поднять щиты']){
    await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible()
  }
  await expect(page.getByText('Редактирование пока отключено')).toBeVisible()
  await expect(page.getByRole('button',{name:/сохранить/i})).toHaveCount(0)
}

async function assertNoHorizontalOverflow(page:Page){
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('Pivnik production legacy read-only managers',()=>{
  test.skip(!baseUrl||!email||!password,'staging credentials required')

  test('desktop renders real wheel and achievement catalogs read-only',async({page})=>{
    await page.setViewportSize({width:1440,height:900})
    const errors=installRuntimeGuards(page)
    await login(page)
    await page.locator('.sidebar').getByRole('button',{name:'Колесо',exact:true}).click()
    await assertWheel(page)
    await assertNoHorizontalOverflow(page)
    await page.locator('.sidebar').getByRole('button',{name:'Достижения',exact:true}).click()
    await assertAchievements(page)
    await assertNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test('mobile 390px keeps wheel and achievements usable without overflow',async({page})=>{
    await page.setViewportSize({width:390,height:844})
    const errors=installRuntimeGuards(page)
    await login(page)
    await page.locator('button.mobile-menu').click()
    await page.locator('.sidebar').getByRole('button',{name:'Колесо',exact:true}).click()
    await assertWheel(page)
    await assertNoHorizontalOverflow(page)
    await page.locator('button.mobile-menu').click()
    await page.locator('.sidebar').getByRole('button',{name:'Достижения',exact:true}).click()
    await assertAchievements(page)
    await assertNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })
})
