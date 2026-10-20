import {test,expect,type Page} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

async function create(page:Page,name:string){
 await page.goto('/')
 await page.getByLabel('Email',{exact:true}).fill('owner@fixture.invalid')
 await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
 await page.getByRole('button',{name:'Войти',exact:true}).click()
 await page.getByRole('button',{name:'Добавить заведение',exact:true}).click()
 await page.getByLabel('Название заведения',{exact:true}).fill(name)
 await page.getByLabel('Организация',{exact:true}).selectOption('10')
 await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click()
 const scope=page.getByRole('region',{name:'Область заведения',exact:true})
 await expect(scope.getByRole('button',{name:'Подготовить CRM',exact:true})).toBeEnabled()
 return scope
}
test('a venue owner prepares the standalone CRM without branding and resumes the same canonical scope',async({page},info)=>{
 const name='CRM без приложения '+info.project.name
 const scope=await create(page,name)
 await expect(page.getByLabel('Название приложения',{exact:true})).toHaveCount(0)
 await expect(page.getByLabel('Основной цвет',{exact:true})).toHaveCount(0)
 await scope.getByRole('button',{name:'Подготовить CRM',exact:true}).click()
 await expect(scope.getByRole('status')).toContainText('Данные CRM подготовлены. CRM ещё не запущена')
 const drafts=await page.request.get('/api/admin/onboarding/drafts').then(r=>r.json())
 const draft=drafts.drafts.find((row:{data:{venueName:string}})=>row.data.venueName===name)
 const before=await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/scope`).then(r=>r.json())
 const app=await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/application`).then(r=>r.json())
 expect(app.application.config).toMatchObject({displayName:name,shopEnabled:false,loyaltyEnabled:true})
 expect(before.scope.venue.active).toBe(false);expect(before.contract.runtimeStatus).toBe('not_provisioned')
 await page.reload()
 await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
 await expect(scope.getByRole('button',{name:'Подготовить CRM',exact:true})).toHaveCount(0)
 await expect(page.getByLabel('Название приложения',{exact:true})).toHaveCount(0)
 const after=await page.request.get(`/api/admin/onboarding/drafts/${draft.id}/scope`).then(r=>r.json())
 expect(after).toEqual(before)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})
test('an uncertain preparation response blocks another write and recovers actual metadata without pretending activation',async({page},info)=>{
 const scope=await create(page,'Ответ CRM '+info.project.name)
 let release!:()=>void,arrived!:()=>void
 const hold=new Promise<void>(resolve=>{release=resolve}),received=new Promise<void>(resolve=>{arrived=resolve})
 await page.route('**/crm/prepare',async route=>{
  const response=await route.fetch(),body=await response.json();arrived();await hold
  await route.fulfill({response,json:{...body,venue:{...body.venue,active:true}}})
 })
 try{
  await scope.getByRole('button',{name:'Подготовить CRM',exact:true}).click();await received
  await expect(scope.getByRole('button',{name:'Подготавливаем…',exact:true})).toBeDisabled()
  release()
  await expect(scope.getByRole('alert')).toContainText('Подготовленная область заведения не подтверждена.')
  await expect(scope.getByRole('button',{name:'Повторить подготовку',exact:true})).toBeDisabled()
  await scope.getByRole('button',{name:'Открыть сохранённую область',exact:true}).click()
  await expect(scope.getByRole('alert')).toHaveCount(0)
  await expect(scope.getByRole('button',{name:'Повторить подготовку',exact:true})).toHaveCount(0)
  await expect(scope.locator('[aria-label="Статус области заведения"]')).toContainText('выключено')
 }finally{release()}
})
