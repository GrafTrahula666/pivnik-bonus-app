import {test,expect,type Page} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

async function open(page:Page,name:string){
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  const binding=page.getByLabel('Статус подготовки базы',{exact:true})
  return binding
}
async function login(page:Page){
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('owner@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.getByRole('button',{name:'Добавить заведение',exact:true})).toBeVisible()
}

test('owner prepares two empty venue databases, schema checks pass and reload keeps the real result without claiming activation',async({page},testInfo)=>{
  await login(page)
  const offset=testInfo.project.name==='mobile'?3:0
  for(const name of ['CRM '+(offset+1),'CRM '+(offset+3)]){
    const binding=await open(page,name)
    await expect(page.getByRole('button',{name:'Подготовить привязку',exact:true})).toBeEnabled()
    await page.getByRole('button',{name:'Подготовить привязку',exact:true}).click()
    await expect(binding).toContainText('Точная привязка создана')
    await expect(binding).toContainText('Не запущено · не опубликовано')
    await page.getByRole('button',{name:'Проверить схему',exact:true}).click()
    await expect(page.getByLabel('Статус проверки схемы',{exact:true})).toContainText('Схема')
    await expect(page.getByRole('button',{name:'Схема проверена',exact:true})).toBeDisabled()
    await expect(page.getByText('Шаг подготовит клиентскую схему', {exact:false})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.reload()
    const restored=await open(page,name)
    await expect(restored).toContainText('Точная привязка создана')
    await expect(restored).toContainText('Не запущено · не опубликовано')
    await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  }
})

test('lost preparation response is recovered from the server without claiming activation',async({page},testInfo)=>{
  await login(page)
  const binding=await open(page,testInfo.project.name==='mobile'?'CRM 5':'CRM 2')
  await expect(page.getByRole('button',{name:'Подготовить привязку',exact:true})).toBeEnabled()
    await page.route('**/provisioning/runtime-database-binding/run',async route=>{
      await route.fetch();await route.abort('failed')
    })
    await page.getByRole('button',{name:'Подготовить привязку',exact:true}).click()
    await expect(page.getByRole('button',{name:'Сначала обновите состояние',exact:true})).toBeDisabled()
    await page.unroute('**/provisioning/runtime-database-binding/run')
    await page.getByRole('button',{name:'Обновить состояние',exact:true}).click()
  await expect(binding).toContainText('Точная привязка создана')
  await expect(binding).toContainText('Попытка 1')
  await expect(binding).toContainText('Не запущено · не опубликовано')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})
