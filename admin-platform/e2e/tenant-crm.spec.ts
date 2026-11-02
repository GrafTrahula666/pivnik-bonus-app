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
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  const readiness=page.getByRole('region',{name:'Готовность CRM к запуску',exact:true})
  await readiness.getByRole('button',{name:'Проверить готовность CRM',exact:true}).click()
  await expect(readiness.getByRole('status')).toHaveText('CRM ещё не запущена. Ниже указано, что нужно завершить.')
  await expect(readiness).toContainText('Клиентов в базе: 355.')
  await expect(readiness).toContainText('Подписка Эвотор.Маркета ещё не подключена.')
  await expect(readiness).toContainText('Запуск CRM ожидает подтверждения подписки')
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
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('present')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 3.')
  await expect(section.getByRole('button',{name:'Zero 0 бонусов',exact:true})).toBeVisible()
  await section.getByRole('combobox',{name:'Порядок',exact:true}).selectOption('desc')
  await expect(section.locator('.tenant-crm-list button').first()).toContainText('Large')
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('missing')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 352.')
  await expect(section.locator('.tenant-crm-list button').first()).toContainText('Pagination fixture 349')
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('all')
  await section.getByRole('combobox',{name:'Порядок',exact:true}).selectOption('asc')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 355.')
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

test('all 355 customers remain reachable through paginated desktop and mobile UI',async({page})=>{
  // Both projects run as separate Playwright processes with isolated fixture servers.
  // Keep the production 30/min per-actor read limit unchanged in every process.
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 355.')
  for(let pageNumber=2;pageNumber<=15;pageNumber++){
    const next=section.getByRole('button',{name:'Далее',exact:true})
    await expect(next).toBeEnabled()
    await next.click()
    await expect(section.getByText('Страница '+pageNumber,{exact:true})).toBeVisible()
    await expect(section.getByRole('status')).toContainText('Найдено клиентов: 355.')
  }
  await expect(section.getByRole('button',{name:'Pagination fixture 349 Кошелёк не создан',exact:true})).toBeVisible()
  await expect(section.getByRole('button',{name:'Далее',exact:true})).toBeDisabled()
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(5)
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
  const readiness=page.getByRole('region',{name:'Готовность CRM к запуску',exact:true})
  await readiness.getByRole('button',{name:'Проверить готовность CRM',exact:true}).click()
  await expect(readiness).toContainText('Клиентов в базе: 355.')
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  const second=await open(page,'CRM 2')
  await expect(page.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Готовность CRM к запуску',exact:true}).getByRole('status')).toHaveCount(0)
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
  // Keep the independent mobile race under the real per-actor 30/min guard.
  await login(page,test.info().project.name==='mobile'?'owner':'root')
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
  let readyReceived!:()=>void
  const readyArrived=new Promise<void>(resolve=>{readyReceived=resolve})
  await page.route('**/crm/readiness',async route=>{
    const response=await route.fetch();readyReceived();await pending
    await route.fulfill({response}).catch(()=>undefined)
  })
  await page.getByRole('region',{name:'Готовность CRM к запуску',exact:true}).getByRole('button',{name:'Проверить готовность CRM',exact:true}).click()
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await arrived;await readyArrived
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  const second=await open(page,'CRM 2')
  release()
  await second.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(second.getByRole('button',{name:'Owned 102 бонусов',exact:true})).toBeVisible()
  await expect(page.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(second.getByText('101 бонусов',{exact:true})).toHaveCount(0)
  await expect(page.getByRole('region',{name:'Готовность CRM к запуску',exact:true}).getByRole('status')).toHaveCount(0)
})
