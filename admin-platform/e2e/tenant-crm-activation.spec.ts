import {test,expect,type Page} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

async function login(page:Page){
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('owner@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.getByRole('button',{name:'Добавить заведение',exact:true})).toBeVisible()
}
async function open(page:Page,name='CRM 1'){
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  const region=page.getByRole('region',{name:'Проверка запуска CRM',exact:true})
  await expect(region.getByRole('button',{name:'Проверить запуск CRM',exact:true})).toBeEnabled()
  return region
}
test('real built CRM persists a blocked activation check and resumes it after reload without a guest artifact',async({page})=>{
  await login(page)
  let region=await open(page)
  const before=Number((await region.getByText(/^Попыток проверки:/).textContent())!.split(':')[1])
  await region.getByRole('button',{name:'Проверить запуск CRM',exact:true}).click()
  await expect(region.getByRole('status')).toHaveText('CRM ещё не запущена.')
  await expect(region).toContainText('Свежая связь с кассой не подтверждена.')
  await expect(region).toContainText('Попыток проверки: '+(before+1))
  await page.reload();region=await open(page)
  await expect(region).toContainText('Попыток проверки: '+(before+1))
  await expect(region).toContainText('Свежая связь с кассой не подтверждена.')
  await expect(region).toContainText('Для CRM-сайта гостевое приложение не обязательно.')
  const drafts=await page.request.get('/api/admin/onboarding/drafts').then(response=>response.json())
  const draft=drafts.drafts.find((row:{data:{venueName:string}})=>row.data.venueName==='CRM 1')
  const scope=await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/scope`).then(response=>response.json())
  expect(scope.scope.venue.active).toBe(false)
  expect((await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/crm/activation-check?license=paid`)).status()).toBe(400)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
test('a delayed real response cannot populate another venue and repeated clicks stay disabled',async({page})=>{
  await login(page)
  const first=await open(page)
  let release!:()=>void,arrived!:()=>void
  const hold=new Promise<void>(resolve=>{release=resolve}),received=new Promise<void>(resolve=>{arrived=resolve})
  await page.route('**/crm/activation-check',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    const response=await route.fetch();arrived();await hold
    await route.fulfill({response}).catch(()=>undefined)
  })
  try{
    await first.getByRole('button',{name:'Проверить запуск CRM',exact:true}).click();await received
    await expect(first.getByRole('button',{name:'Проверить запуск CRM',exact:true})).toBeDisabled()
    await page.getByRole('button',{name:'Закрыть',exact:true}).click()
    const second=await open(page,'CRM 2')
    const before=await second.getByText(/^Попыток проверки:/).textContent()
    release()
    await second.getByRole('button',{name:'Обновить состояние запуска',exact:true}).click()
    await expect(second.getByText(/^Попыток проверки:/)).toHaveText(before!)
    await expect(second).not.toContainText('Свежая связь с кассой не подтверждена.')
  }finally{release()}
})
test('the UI refuses an unverified active response and restores actual server state on refresh',async({page})=>{
  await login(page)
  let corrupt=true
  await page.route('**/crm/activation-check',async route=>{
    const response=await route.fetch()
    if(!corrupt){await route.fulfill({response});return}
    const body=await response.json()
    await route.fulfill({response,json:{...body,activationAllowed:true,crmStatus:'active'}})
  })
  await page.getByRole('button',{name:'Открыть черновик CRM 1',exact:true}).click()
  const region=page.getByRole('region',{name:'Проверка запуска CRM',exact:true})
  await expect(region.getByRole('alert')).toContainText('Результат проверки не подтверждён.')
  await expect(region.getByRole('button',{name:'Проверить запуск CRM',exact:true})).toBeDisabled()
  corrupt=false
  await region.getByRole('button',{name:'Обновить состояние запуска',exact:true}).click()
  await expect(region.getByRole('button',{name:'Проверить запуск CRM',exact:true})).toBeEnabled()
  await expect(region.getByRole('status')).toHaveText('CRM ещё не запущена.')
})
