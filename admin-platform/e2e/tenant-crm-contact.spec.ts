// Browser acceptance of built real Admin UI on a synthetic loopback fixture.
// POSTs are intercepted intentionally: authorization + real PostgreSQL
// are proven by the separate signed HTTP/native PG16 workflow.
import {expect,test} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

test('owner-only manual CRM contact form: real desktop/mobile UI, uncertain retry, no bonus wallet',async({page},info)=>{
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('root@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.getByRole('button',{name:'Добавить заведение',exact:true}).click()
  const name='CRM Контакт '+info.project.name
  await page.getByLabel('Название заведения',{exact:true}).fill(name)
  await page.getByLabel('Адрес',{exact:true}).fill('Тестовый адрес, без реального заведения')
  await page.getByLabel('Email владельца',{exact:true}).fill('owner@fixture.invalid')
  const draftPost=page.waitForResponse(r=>r.url().endsWith('/api/admin/onboarding/drafts')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click()
  const draft=await (await draftPost).json() as {id:string}
  expect(draft.id).toMatch(/^[0-9a-f-]{36}$/i)
  await page.getByRole('button',{name:'Сохранить приложение',exact:true}).click()
  const prepare=page.waitForResponse(r=>r.url().endsWith('/scope')&&r.request().method()==='PUT')
  await page.getByRole('button',{name:'Подготовить область',exact:true}).click()
  const scope=await (await prepare).json() as {venue:{active:boolean};contract:{runtimeStatus:string}}
  expect(scope.venue.active).toBe(false)
  expect(scope.contract.runtimeStatus).toBe('not_provisioned')
  const form=page.getByRole('region',{name:'Создать ручной контакт CRM'})
  await expect(form).toBeVisible()
  await expect(form).toContainText('Бонусы и профиль гостя не создаются')
  // The test intercept is not a fake production database. It only validates
  // browser transport, fields, safe retransmission and rendering.
  const requests:{url:string;key:string;body:Record<string,unknown>;csrf:string|undefined}[]=[]
  await page.route('**/api/admin/onboarding/drafts/*/crm/contacts',async route=>{
    const req=route.request()
    const data=req.postDataJSON() as {requestKey:string;contact:Record<string,unknown>}
    requests.push({url:req.url(),key:data.requestKey,body:data.contact,csrf:req.headers()['x-csrf-token']})
    const attempt=requests.length
    if(attempt===1){await route.fulfill({status:503,contentType:'application/json',
      body:JSON.stringify({code:'TENANT_CRM_CONTACT_UNAVAILABLE',error:'Result unknown'})});return}
    if(attempt===2){await route.fulfill({status:429,contentType:'application/json',
      body:JSON.stringify({code:'RATE_LIMITED',error:'Retry after a minute'})});return}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      schemaVersion:1,requestKey:data.requestKey,
      contact:{id:'911',firstName:data.contact.firstName,lastName:data.contact.lastName,
        phone:data.contact.phone,email:data.contact.email,
        identityStatus:'unlinked',walletStatus:'not_created'},
      identityStatus:'unlinked',walletStatus:'not_created',
    })})
  })
  await form.getByLabel('Имя *').fill('Анна')
  await form.getByLabel('Email',{exact:true}).fill('Anna@Fixture.invalid')
  await form.getByRole('button',{name:'Создать контакт',exact:true}).dblclick()
  await expect(form.getByRole('alert')).toContainText('Подтверждение не получено')
  await expect(form.getByLabel('Имя *')).toBeDisabled()
  await expect(form.getByLabel('Email',{exact:true})).toBeDisabled()
  await form.getByRole('button',{name:'Повторить с тем же ключом'}).click()
  await expect(form).toContainText('Слишком много запросов')
  await expect(form.getByLabel('Имя *')).toBeDisabled()
  await form.getByRole('button',{name:'Повторить с тем же ключом'}).click()
  await expect(form.getByRole('status')).toContainText('Контакт №911 создан')
  await expect(form.getByRole('status')).toContainText('кошелёк не создан')
  expect(requests).toHaveLength(3)
  for(const entry of requests){
    expect(entry.url).toContain('/drafts/'+draft.id+'/crm/contacts')
    expect(entry.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(entry.csrf).toBeTruthy()
    expect(entry.body).toEqual({firstName:'Анна',lastName:null,phone:null,email:'anna@fixture.invalid'})
  }
  expect(requests[0]!.key).toBe(requests[1]!.key)
  expect(requests[1]!.key).toBe(requests[2]!.key)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
