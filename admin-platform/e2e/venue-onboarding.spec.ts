import fs from 'node:fs/promises'
import { test,expect } from '@playwright/test'
import { fixturePassword } from '../server/tests/onboarding-fixture'

test('real panel saves, reloads, updates and recovers an uncertain server save',async({page},testInfo)=>{
  const name=`Мулино ${testInfo.project.name}`
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('root@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await page.getByRole('button',{name:'Добавить заведение',exact:true}).click()
  await page.getByLabel('Название заведения',{exact:true}).fill(name)
  await expect(page.getByLabel('Название организации',{exact:true})).toHaveValue(name)
  await page.getByLabel('Адрес',{exact:true}).fill('Мулино, тестовая улица')
  await page.getByLabel('Email владельца',{exact:true}).fill('new-owner@fixture.invalid')
  const post=page.waitForResponse(response=>response.url().endsWith('/api/admin/onboarding/drafts')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).dblclick()
  const created=await (await post).json() as {id:string;revision:number}
  expect(created.revision).toBe(1)
  await expect(page.getByRole('status')).toContainText('Заведение ещё не подключено')
  await page.reload()
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  await expect(page.getByLabel('Адрес',{exact:true})).toHaveValue('Мулино, тестовая улица')
  await page.getByLabel('Адрес',{exact:true}).fill('Мулино, изменённый адрес')
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Черновик сохранён')
  await page.reload()
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  await expect(page.getByLabel('Адрес',{exact:true})).toHaveValue('Мулино, изменённый адрес')

  // Execute the real POST, then lose its HTTP result. Reload must find the existing server draft.
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  await page.getByRole('button',{name:'Добавить заведение',exact:true}).click()
  const recoveredName=name+' восстановление'
  await page.getByLabel('Название заведения',{exact:true}).fill(recoveredName)
  let committedId='',posts=0
  await page.route('**/api/admin/onboarding/drafts',async route=>{
    if(route.request().method()!=='POST') {await route.continue();return}
    posts++
    const response=await route.fetch()
    committedId=(await response.json() as {id:string}).id
    await route.abort('failed')
  })
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click()
  await expect(page.getByRole('button',{name:'Повторить сохранение',exact:true})).toBeVisible()
  await expect(page.getByLabel('Название заведения',{exact:true})).toBeDisabled()
  await page.unroute('**/api/admin/onboarding/drafts')
  await page.reload()
  await expect(page.getByLabel('Название заведения',{exact:true})).toHaveValue(recoveredName)
  await expect(page.getByRole('status')).toContainText('Черновик сохранён')
  expect(posts).toBe(1)
  const index=await (await page.request.get('/api/admin/onboarding/drafts')).json() as {drafts:{id:string;data:{venueName:string}}[]}
  expect(index.drafts.filter(draft=>draft.data.venueName===recoveredName).map(draft=>draft.id)).toEqual([committedId])
  expect(index.drafts.filter(draft=>draft.data.venueName===name)).toHaveLength(1)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const screenshot=`artifacts/onboarding-${testInfo.project.name}.png`
  await fs.mkdir('artifacts',{recursive:true})
  await page.screenshot({path:screenshot,fullPage:true})
})

test('venue owners cannot see or directly use the master',async({page})=>{
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('owner@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.getByRole('button',{name:'Добавить заведение',exact:true})).toHaveCount(0)
  expect((await page.request.get('/api/admin/onboarding/drafts')).status()).toBe(403)
})
