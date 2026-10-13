import {expect,test} from '@playwright/test'

// The public demo opens from the login page without an account and never touches venue data.
test('demo guest sees sample data only and can leave back to the login page',async({page})=>{
  const venueCalls:string[]=[]
  page.on('request',request=>{if(/\/api\/admin\/(venues|platform|audit)/.test(request.url()))venueCalls.push(request.url())})
  await page.context().clearCookies()
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Посмотреть демо-версию'}).click()
  await expect(page.locator('.demo-watermark')).toBeVisible()
  await expect(page.getByRole('button',{name:'Рабочий режим'})).toHaveCount(0)
  await page.getByRole('button',{name:'Клиенты'}).first().click()
  await expect(page.locator('.demo-watermark')).toBeVisible()
  expect(venueCalls).toEqual([])
  await page.locator('.profile-button').hover()
  await page.getByRole('button',{name:'Выйти из демо'}).click()
  await expect(page.getByRole('heading',{name:'Вход в панель управления'})).toBeVisible()
})
