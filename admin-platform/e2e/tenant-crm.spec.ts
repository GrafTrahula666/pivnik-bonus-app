import {test,expect,type Page} from '@playwright/test'
import {fixturePassword} from '../server/tests/onboarding-fixture'

async function login(page:Page,who='root'){
  await page.goto('/')
  await page.getByLabel('Email',{exact:true}).fill(who+'@fixture.invalid')
  await page.getByLabel('Пароль',{exact:true}).fill(fixturePassword)
  await page.getByRole('button',{name:'Войти',exact:true}).click()
  await expect(page.getByRole('button',{name:'Добавить заведение',exact:true})).toBeVisible()
}
async function open(page:Page,name:string){
  await page.getByRole('button',{name:'Открыть черновик '+name,exact:true}).click()
  const section=page.getByRole('region',{name:'Проверка клиентской базы',exact:true})
  await expect(section.getByRole('button',{name:'Проверить клиентскую базу',exact:true})).toBeVisible()
  return section
}

test('built panel reads and searches real isolated customer SQL with precise balances',async({page})=>{
  await login(page)
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('status')).toHaveText('Доступ к клиентской базе проверен. Найдено клиентов: 355.')
  await expect(section.getByRole('button',{name:'Zero 0 бонусов',exact:true})).toBeVisible()
  await expect(section.getByRole('button',{name:'No wallet Кошелёк не создан',exact:true})).toBeVisible()
  await section.getByRole('button',{name:'Large 9 007 199 254 740 993 бонусов',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Баланс: 9 007 199 254 740 993 бонусов')
  await section.getByRole('button',{name:'Далее',exact:true}).click()
  await expect(section.getByText('Страница 2',{exact:true})).toBeVisible()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await section.getByLabel('Найти клиента',{exact:true}).fill('Pagination fixture 349')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 1.')
  await expect(section.getByRole('button',{name:'Pagination fixture 349 Кошелёк не создан',exact:true})).toBeVisible()
  await section.getByLabel('Найти клиента',{exact:true}).fill('_100%')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('button',{name:'Анна_100% Кошелёк не создан',exact:true})).toBeVisible()
  await section.getByLabel('Найти клиента',{exact:true}).fill('No matching customer')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 0.')
  await expect(section.getByText('Клиенты не найдены. Измените поисковый запрос.',{exact:true})).toBeVisible()
  // Continue the same owner journey; do not weaken the real login/read rate limits.
  await section.getByLabel('Найти клиента',{exact:true}).fill('')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers?**',route=>route.abort('failed'))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toContainText('Не удалось подтвердить данные этого заведения.')
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await expect(section.getByRole('status')).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 355.')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})

test('changing venue clears customers and the server denies another company owner',async({page})=>{
  await login(page)
  const drafts=await page.request.get('/api/admin/onboarding/drafts').then(response=>response.json())
  const foreign=drafts.drafts.find((draft:{data:{venueName:string}})=>draft.data.venueName==='CRM 3')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Баланс: 101 бонусов')
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  const second=await open(page,'CRM 2')
  await expect(page.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await second.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(second.getByRole('button',{name:'Owned 102 бонусов',exact:true})).toBeVisible()
  await expect(second.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toHaveCount(0)
  await page.locator('.profile-button').click()
  await page.getByRole('button',{name:'Выйти',exact:true}).click()
  await login(page,'owner')
  expect((await page.request.get(`/api/admin/onboarding/drafts/${foreign.id}/crm/customers`)).status()).toBe(404)
  await expect(page.getByRole('button',{name:'Открыть черновик CRM 3',exact:true})).toHaveCount(0)
})

test('late real customer response cannot reopen a card from the previous venue',async({page})=>{
  await login(page)
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  let release!:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  let received!:()=>void
  const arrived=new Promise<void>(resolve=>{received=resolve})
  await page.route('**/crm/customers/1',async route=>{
    const response=await route.fetch();received();await pending
    await route.fulfill({response}).catch(()=>undefined)
  })
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await arrived
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  const second=await open(page,'CRM 2')
  release()
  await second.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(second.getByRole('button',{name:'Owned 102 бонусов',exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(second.getByText('101 бонусов',{exact:true})).toHaveCount(0)
})
