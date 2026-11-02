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
  const pendingStorage=await page.evaluate(()=>{
    const key=Object.keys(localStorage).find(key=>key.startsWith('spaceverse:crm-manual-contact:pending:v1:'))
    return key?{key,value:localStorage.getItem(key)}:null
  })
  expect(pendingStorage?.value).not.toContain('Анна')
  expect(pendingStorage?.value).not.toContain('anna@fixture.invalid')
  expect(JSON.parse(pendingStorage!.value!)).toMatchObject({
    version:1,requestKey:requests[0]!.key,
  })
  // A full page reload must not silently mint another contact request key.
  await page.reload()
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  const restored=page.getByRole('region',{name:'Создать ручной контакт CRM'})
  await expect(restored).toContainText('Есть незавершённый запрос')
  await restored.getByLabel('Имя *').fill('Анна')
  await restored.getByLabel('Email',{exact:true}).fill('wrong@fixture.invalid')
  await restored.getByRole('button',{name:'Восстановить исходный запрос'}).click()
  await expect(restored.getByRole('alert')).toContainText('Данные отличаются')
  expect(requests).toHaveLength(1)
  await restored.getByLabel('Email',{exact:true}).fill('Anna@Fixture.invalid')
  await restored.getByRole('button',{name:'Восстановить исходный запрос'}).click()
  await expect(restored).toContainText('Слишком много запросов')
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
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('spaceverse:crm-manual-contact:pending:v1:')).length)).toBe(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})

test('VENUE_ADMIN owner can see prepared manual CRM contact; trusted account cannot open it',async({page,browser},info)=>{
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('owner@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.getByRole('button',{name:'Добавить заведение',exact:true}).click()
  const name='CRM owner grant '+info.project.name
  await page.getByLabel('Название заведения',{exact:true}).fill(name)
  await page.getByLabel('Организация',{exact:true}).selectOption('10')
  const createdResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/onboarding/drafts')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click()
  const draft=await (await createdResponse).json() as {id:string}
  expect(draft.id).toMatch(/^[0-9a-f-]{36}$/i)
  await page.getByRole('button',{name:'Сохранить приложение',exact:true}).click()
  const scopeResponse=page.waitForResponse(r=>r.url().endsWith('/scope')&&r.request().method()==='PUT')
  await page.getByRole('button',{name:'Подготовить область',exact:true}).click()
  const prepared=await (await scopeResponse).json() as {venue:{active:boolean};contract:{runtimeStatus:string}}
  expect(prepared.venue.active).toBe(false)
  expect(prepared.contract.runtimeStatus).toBe('not_provisioned')
  await expect(page.getByRole('region',{name:'Создать ручной контакт CRM'})).toBeVisible()

  // A trusted director is not a verified owner of this company. The server
  // must not expose the owner's draft, regardless of the browser capability.
  const context=await browser.newContext({viewport:page.viewportSize()||{width:1440,height:960}})
  try{
    const trusted=await context.newPage()
    await trusted.goto('/')
    await trusted.getByLabel('Email',{exact:true}).fill('trusted@fixture.invalid')
    await trusted.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
    await trusted.getByRole('button',{name:'Войти',exact:true}).click()
    await expect(trusted.locator('.app-shell')).toBeVisible()
    await expect(trusted.getByRole('region',{name:'Создать ручной контакт CRM'})).toHaveCount(0)
    const denied=await trusted.request.get('/api/admin/onboarding/drafts/'+draft.id)
    expect([403,404]).toContain(denied.status())

    // The exact same trusted account now gains a genuine scoped manager
    // invitation in disposable metadata. It can edit the draft, not create
    // manual CRM contacts: UI and actual signed Admin route must agree.
    const ownerSession=await (await page.request.get('/api/admin/auth/session')).json() as {
      csrfToken:string
    }
    const grant=await page.request.post('/__fixture/crm-contact/manager-grant',{
      headers:{'x-csrf-token':ownerSession.csrfToken,origin:'http://127.0.0.1:5097'},
      data:{draftId:draft.id},
    })
    expect(grant.status()).toBe(200)
    expect(await grant.json()).toMatchObject({grant:'manager',draftId:draft.id})
    const allowed=await trusted.request.get('/api/admin/onboarding/drafts/'+draft.id)
    expect(allowed.status()).toBe(200)
    const managerDraft=await allowed.json() as {permissions:{canWrite:boolean;role:string}}
    expect(managerDraft.permissions).toEqual({canWrite:true,role:'manager'})
    await trusted.reload()
    await expect(trusted.getByRole('button',{name:'Открыть черновик '+name,exact:true})).toBeVisible()
    await trusted.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
    await expect(trusted.getByLabel('Название заведения',{exact:true})).toHaveValue(name)
    await expect(trusted.getByRole('region',{name:'Создать ручной контакт CRM'})).toHaveCount(0)
    const managerSession=await (await trusted.request.get('/api/admin/auth/session')).json() as {
      csrfToken:string
    }
    const write=await trusted.request.post('/api/admin/onboarding/drafts/'+draft.id+'/crm/contacts',{
      headers:{'x-csrf-token':managerSession.csrfToken,origin:'http://127.0.0.1:5097'},
      data:{requestKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12',
        contact:{firstName:'Только тест',lastName:null,phone:null,email:'manager@fixture.invalid'}},
    })
    expect([403,404]).toContain(write.status())
    await expect(trusted.getByRole('region',{name:'Создать ручной контакт CRM'})).toHaveCount(0)
  }finally{
    await context.close()
  }
})


test('real cross-tab Web Lock queues creation and rechecks a foreign pending key before POST',async({page},info)=>{
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('root@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.getByRole('button',{name:'Добавить заведение',exact:true}).click()
  const name='CRM Web Lock '+info.project.name
  await page.getByLabel('Название заведения',{exact:true}).fill(name)
  await page.getByLabel('Адрес',{exact:true}).fill('Синтетический адрес')
  await page.getByLabel('Email владельца',{exact:true}).fill('owner@fixture.invalid')
  const draftResponse=page.waitForResponse(r=>r.url().endsWith('/api/admin/onboarding/drafts')&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click()
  const draft=await (await draftResponse).json() as {id:string}
  await page.getByRole('button',{name:'Сохранить приложение',exact:true}).click()
  const scopeResponse=page.waitForResponse(r=>r.url().endsWith('/scope')&&r.request().method()==='PUT')
  await page.getByRole('button',{name:'Подготовить область',exact:true}).click()
  expect((await (await scopeResponse).json() as {contract:{runtimeStatus:string}}).contract.runtimeStatus)
    .toBe('not_provisioned')
  await expect(page.getByRole('region',{name:'Создать ручной контакт CRM'})).toBeVisible()

  const other=await page.context().newPage()
  const lockName='spaceverse:crm-manual-contact:lock:v1:1:'+draft.id
  const storageKey='spaceverse:crm-manual-contact:pending:v1:1:'+draft.id
  const foreign=JSON.stringify({version:1,
    requestKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    nonce:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',digest:'a'.repeat(64)})
  let postCount=0
  try{
    await other.goto('/')
    await other.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
    const form=other.getByRole('region',{name:'Создать ручной контакт CRM'})
    await expect(form).toBeVisible()
    await other.route('**/api/admin/onboarding/drafts/*/crm/contacts',async route=>{
      postCount++
      await route.fulfill({status:503,contentType:'application/json',
        body:JSON.stringify({code:'TENANT_CRM_CONTACT_UNAVAILABLE'})})
    })
    // Hold the actual browser lock in tab A, not a mocked navigator.locks.
    await page.evaluate(async name=>{
      let signalHeld!:()=>void
      const held=new Promise<void>(resolve=>{signalHeld=resolve})
      void navigator.locks.request(name,async()=>{
        signalHeld()
        await new Promise<void>(resolve=>{
          (window as typeof window & {releaseCrmTestLock?:()=>void}).releaseCrmTestLock=resolve
        })
      })
      await held
    },lockName)
    try{
      await form.getByLabel('Имя *').fill('Мария')
      await form.getByLabel('Email',{exact:true}).fill('queued@fixture.invalid')
      await form.getByRole('button',{name:'Создать контакт',exact:true}).click()
      // Browser Web Locks must show tab B queued behind tab A.
      await expect.poll(()=>other.evaluate(async name=>
        (await navigator.locks.query()).pending?.some(lock=>lock.name===name)===true,
      lockName)).toBe(true)
      expect(postCount).toBe(0)
      // Write in the waiting tab itself: no cross-tab storage event is fired
      // there. The queued callback must independently re-read localStorage.
      await other.evaluate(({key,value})=>localStorage.setItem(key,value),
        {key:storageKey,value:foreign})
    }finally{
      await page.evaluate(()=>
        (window as typeof window & {releaseCrmTestLock?:()=>void}).releaseCrmTestLock?.())
    }
    await expect(form.getByRole('alert')).toContainText('Нельзя безопасно восстановить')
    await expect(form.locator('fieldset')).toBeDisabled()
    expect(postCount).toBe(0)
    expect(await other.evaluate(key=>localStorage.getItem(key),storageKey)).toBe(foreign)
  }finally{
    await other.close()
  }
})
