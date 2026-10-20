import {test,expect,type Page} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

async function login(page:Page,who='owner'){
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill(who+'@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.getByRole('button',{name:'Добавить заведение',exact:true})).toBeVisible()
}
async function open(page:Page,name='CRM 1'){
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  const help=page.getByRole('region',{name:'Помощь с подключением',exact:true})
  await expect(help).toBeVisible();return help
}

test('lost response recovers the real saved ticket, reload keeps its number and operator sees the internal queue',async({page})=>{
  await login(page)
  const help=await open(page)
  await expect(help.getByRole('button',{name:'Сохранить обращение',exact:true})).toBeEnabled()
  await page.route('**/drafts/*/support',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    await route.fetch();await route.abort('failed')
  })
  await help.getByRole('button',{name:'Сохранить обращение',exact:true}).click()
  await expect(help.getByRole('alert')).toContainText('Сохранение не подтверждено')
  await expect(help.getByRole('button',{name:'Сохранить обращение',exact:true})).toBeDisabled()
  await page.unroute('**/drafts/*/support')
  await help.getByRole('button',{name:'Обновить обращения',exact:true}).click()
  await expect(help).toContainText('Сохранено в панели · прочтение не подтверждено')
  const reference=await help.locator('.support-reference').first().innerText()
  await help.getByRole('button',{name:'Сохранить обращение',exact:true}).click()
  await expect(help.locator('.support-reference')).toHaveCount(1)
  await expect(help.locator('.support-reference')).toHaveText(reference)
  await page.reload();const restored=await open(page)
  await expect(restored.locator('.support-reference')).toHaveText(reference)
  expect((await page.request.get('/api/admin/onboarding/support')).status()).toBe(403)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.locator('.profile-button').click();await page.getByRole('button',{name:'Выйти',exact:true}).click()
  await login(page,'root')
  const queue=page.getByRole('region',{name:'Очередь обращений платформы',exact:true})
  await expect(queue).toContainText(reference)
  await expect(queue).toContainText('Подключение кассы')
  await expect(queue).toContainText('прочтение не подтверждено')
})

test('late or contradictory support response cannot expose the previous venue or claim delivery',async({page})=>{
  await login(page)
  const first=await open(page,'CRM 2')
  await expect(first.getByRole('button',{name:'Сохранить обращение',exact:true})).toBeEnabled()
  await first.getByRole('button',{name:'Сохранить обращение',exact:true}).click()
  await expect(first.locator('.support-reference')).toHaveCount(1)
  const reference=await first.locator('.support-reference').first().innerText()
  let arrived!:()=>void,release!:()=>void
  const received=new Promise<void>(resolve=>{arrived=resolve}),wait=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/drafts/*/support',async route=>{
    const response=await route.fetch();arrived();await wait;await route.fulfill({response}).catch(()=>undefined)
  },{times:1})
  await first.getByRole('button',{name:'Обновить обращения',exact:true}).click();await received
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  const second=await open(page,'CRM 1');release()
  await expect(second.getByRole('button',{name:'Сохранить обращение',exact:true})).toBeEnabled()
  await expect(second).not.toContainText(reference)
  await page.route('**/drafts/*/support',async route=>{
    const response=await route.fetch(),body=await response.json()
    await route.fulfill({response,json:{...body,externalNotificationSent:true}})
  })
  await second.getByRole('button',{name:'Обновить обращения',exact:true}).click()
  await expect(second.getByRole('alert')).toContainText('Сохранение не подтверждено')
  await expect(second.getByRole('button',{name:'Сохранить обращение',exact:true})).toBeDisabled()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
