import {test,expect} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

test('disabled customer diagnostic exposes neither a UI control nor a working API',async({page})=>{
  let automaticReads=0
  page.on('request',request=>{if(request.url().includes('/crm/'))automaticReads++})
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('root@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await page.getByRole('button',{name:'Открыть черновик CRM 1',exact:true}).click()
  await expect(page.getByRole('region',{name:'Помощь с подключением',exact:true})).toHaveCount(0)
  expect((await page.request.get('/api/admin/onboarding/support')).status()).toBe(403)
  await expect(page.getByLabel('Название заведения',{exact:true})).toHaveValue('CRM 1')
  await expect(page.getByRole('region',{name:'Проверка клиентской базы',exact:true})).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Готовность CRM к запуску',exact:true})).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Проверка запуска CRM',exact:true})).toHaveCount(0)
  const session=await page.request.get('/api/admin/auth/session').then(response=>response.json())
  expect(session.capabilities.tenantCrmReads).toBe(false)
  expect(session.capabilities.tenantCrmActivationChecks).toBe(false)
  const drafts=await page.request.get('/api/admin/onboarding/drafts').then(response=>response.json())
  const draft=drafts.drafts.find((row:{data:{venueName:string}})=>row.data.venueName==='CRM 1')
  expect((await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/crm/customers`)).status()).toBe(403)
  expect((await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/crm/readiness`)).status()).toBe(403)
  expect((await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/crm/activation-check`)).status()).toBe(403)
  expect(automaticReads).toBe(0)
  const venues=await page.request.get('/api/admin/onboarding/venues').then(response=>response.json())
  expect(venues.venues.every((row:Record<string,unknown>)=>!Object.hasOwn(row,'crmActivation'))).toBe(true)
})
