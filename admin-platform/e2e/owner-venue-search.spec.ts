import {test,expect,type Page} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

async function login(page:Page){
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill('network-owner@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  const list=page.getByRole('region',{name:'Все заведения',exact:true})
  await expect(list.getByText(/^Показано 25 из /)).toBeVisible()
  return list
}
async function search(page:Page,value:string){
  const list=page.getByRole('region',{name:'Все заведения',exact:true})
  await list.getByLabel('Поиск заведений',{exact:true}).fill(value)
  await list.getByRole('button',{name:'Найти заведение',exact:true}).click()
  await expect(list.getByText('Результаты по запросу «'+value+'»',{exact:true})).toBeVisible()
  return list
}
test('a network owner searches all stores before pagination and can return to the whole network',async({page})=>{
  const list=await login(page)
  await search(page,'каталог')
  await expect(list.getByText('Показано 25 из 302',{exact:true})).toBeVisible()
  await list.getByRole('button',{name:'Показать ещё заведения',exact:true}).click()
  await expect(list.getByText('Показано 50 из 302',{exact:true})).toBeVisible()
  await search(page,'Каталог 301')
  await expect(list.getByText('Показано 1 из 1',{exact:true})).toBeVisible()
  await expect(list.locator('li')).toHaveCount(1)
  await expect(list.locator('li')).toContainText('Каталог 301')
  await search(page,'юГ')
  await expect(list.getByRole('region',{name:'Запуск CRM: CRM 3',exact:true})).toBeVisible()
  await search(page,'%')
  await expect(list.getByText('Показано 1 из 1',{exact:true})).toBeVisible()
  await expect(list.locator('li')).toContainText('Точка 100%_плюс')
  await search(page,'Неизвестное заведение')
  await expect(list).toContainText('По вашему запросу заведений не найдено.')
  await expect(list).not.toContainText('Заведений пока нет.')
  await list.getByRole('button',{name:'Сбросить поиск',exact:true}).click()
  await expect(list.getByText(/^Показано 25 из /)).toBeVisible()
  await expect(list.getByLabel('Поиск заведений',{exact:true})).toHaveValue('')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})

test('late and mismatched search responses cannot replace the current network result',async({page})=>{
  const list=await login(page)
  let release!:()=>void,arrived!:()=>void
  const hold=new Promise<void>(resolve=>{release=resolve}),received=new Promise<void>(resolve=>{arrived=resolve})
  await page.route('**/api/admin/onboarding/venues**',async route=>{
    if(new URL(route.request().url()).searchParams.get('q')!=='Каталог'){await route.continue();return}
    const response=await route.fetch();arrived();await hold
    await route.fulfill({response}).catch(()=>undefined)
  })
  try{
    await list.getByLabel('Поиск заведений',{exact:true}).fill('Каталог')
    await list.getByRole('button',{name:'Найти заведение',exact:true}).click();await received
    await expect(list.locator('li')).toHaveCount(0)
    await search(page,'CRM')
    await expect(list.getByText('Показано 3 из 3',{exact:true})).toBeVisible()
    release()
    await list.getByRole('button',{name:'Обновить заведения',exact:true}).click()
    await expect(list.getByText('Показано 3 из 3',{exact:true})).toBeVisible()
    await expect(list.locator('li')).toHaveCount(3)
  }finally{release()}
  await page.unroute('**/api/admin/onboarding/venues**')
  let corrupt=true
  await page.route('**/api/admin/onboarding/venues**',async route=>{
    const response=await route.fetch(),body=await response.json()
    await route.fulfill({response,json:corrupt?{...body,q:'другой запрос'}:body})
  })
  await list.getByLabel('Поиск заведений',{exact:true}).fill('Юг')
  await list.getByRole('button',{name:'Найти заведение',exact:true}).click()
  await expect(list.getByRole('alert')).toHaveText('Сервер не подтвердил состояния заведений.')
  await expect(list.locator('li')).toHaveCount(0)
  corrupt=false
  await list.getByRole('button',{name:'Обновить заведения',exact:true}).click()
  await expect(list.getByRole('region',{name:'Запуск CRM: CRM 3',exact:true})).toBeVisible()
  await expect(list.getByLabel('Поиск заведений',{exact:true})).toHaveValue('Юг')
})
