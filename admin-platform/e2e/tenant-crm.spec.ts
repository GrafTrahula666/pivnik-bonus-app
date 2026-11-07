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
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Идентификатор клиента: 3')
  // An absent wallet must not be presented as a real zero balance.
  await section.getByRole('button',{name:'No wallet Кошелёк не создан',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Бонусный кошелёк ещё не создан.')
  await expect(section.getByRole('region',{name:'Карточка клиента'})).not.toContainText('Баланс: 0 бонусов')
  await section.getByRole('button',{name:'Далее',exact:true}).click()
  await expect(section.getByText('Страница 2',{exact:true})).toBeVisible()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await section.getByLabel('Найти клиента',{exact:true}).fill('Pagination fixture 349')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  // Search from page 2 must reset server pagination to page 1, not leave an empty offset.
  await expect(section.getByText('Страница 1',{exact:true})).toBeVisible()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 1.')
  await expect(section.getByRole('button',{name:'Pagination fixture 349 Кошелёк не создан',exact:true})).toBeVisible()
  await section.getByLabel('Найти клиента',{exact:true}).fill('_100%')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('button',{name:'Анна_100% Кошелёк не создан',exact:true})).toBeVisible()
  await section.getByLabel('Найти клиента',{exact:true}).fill('No matching customer')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 0.')
  await expect(section.getByText('По запросу клиентов не найдено. Измените поиск или фильтр кошелька.',{exact:true})).toBeVisible()
  // Continue the same owner journey; do not weaken the real login/read rate limits.
  await section.getByLabel('Найти клиента',{exact:true}).fill('')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('present')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 3.')
  await expect(section.getByRole('button',{name:'Zero 0 бонусов',exact:true})).toBeVisible()
  // An unmatched search under an active wallet filter must remain a genuine empty result,
  // not silently drop the filter or misreport an empty customer database.
  await section.getByLabel('Найти клиента',{exact:true}).fill('No wallet')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 0.')
  await expect(section.getByText('По запросу клиентов не найдено. Измените поиск или фильтр кошелька.',{exact:true})).toBeVisible()
  await expect(section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true})).toHaveValue('present')
  await section.getByLabel('Найти клиента',{exact:true}).fill('')
  await section.getByRole('button',{name:'Найти',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 3.')
  // Changing wallet scope must close an already-open customer card before new rows arrive.
  await section.getByRole('button',{name:'Zero 0 бонусов',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Баланс: 0 бонусов')
  await section.getByRole('combobox',{name:'Порядок',exact:true}).selectOption('desc')
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(section.locator('.tenant-crm-list button').first()).toContainText('Large')
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('missing')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 352.')
  // A missing-wallet filter must exclude genuine zero-balance wallets, not treat zero as missing.
  await expect(section.getByRole('button',{name:'Zero 0 бонусов',exact:true})).toHaveCount(0)
  await expect(section.locator('.tenant-crm-list button').first()).toContainText('Pagination fixture 349')
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('all')
  await section.getByRole('combobox',{name:'Порядок',exact:true}).selectOption('asc')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 355.')
  // Retry must preserve the active server-side wallet filter, not silently return all customers.
  await section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true}).selectOption('missing')
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 352.')
  await section.getByRole('combobox',{name:'Порядок',exact:true}).selectOption('desc')
  await expect(section.locator('.tenant-crm-list button').first()).toContainText('Pagination fixture 349')
  // A failed list refresh must not leave a previously opened customer detail visible.
  await section.getByRole('button',{name:'Pagination fixture 349 Кошелёк не создан',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Бонусный кошелёк ещё не создан.')
  await page.route('**/crm/customers?**',route=>route.abort('failed'))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(section.getByRole('alert')).toContainText('Не удалось подтвердить данные этого заведения.')
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await expect(section.getByRole('status')).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 352.')
  await expect(section.getByRole('combobox',{name:'Бонусный кошелёк',exact:true})).toHaveValue('missing')
  await expect(section.getByRole('combobox',{name:'Порядок',exact:true})).toHaveValue('desc')
  await expect(section.locator('.tenant-crm-list button').first()).toContainText('Pagination fixture 349')
  await expect(section.getByRole('button',{name:'Zero 0 бонусов',exact:true})).toHaveCount(0)
  // A 403 after a successful retry must also invalidate an open customer detail.
  await section.getByRole('button',{name:'Pagination fixture 349 Кошелёк не создан',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Бонусный кошелёк ещё не создан.')
  // A server permission denial must fail closed, not keep showing cached customer rows.
  await page.route('**/crm/customers?**',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'forbidden'})}))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toContainText('Проверка недоступна или у вас нет доступа к клиентам этого заведения.')
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 352.')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
})


test('rate-limited customer list clears stale rows and recovers without weakening guard',async({page})=>{
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers?**',route=>route.fulfill({
    status:429,contentType:'application/json',body:JSON.stringify({error:'rate_limited'})
  }))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toContainText('Слишком частые проверки. Повторите через минуту.')
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByRole('status')).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
})

test('server 500 on customer list clears stale rows and recovers on retry',async({page})=>{
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers?**',route=>route.fulfill({
    status:500,contentType:'application/json',body:JSON.stringify({error:'internal_error'})
  }))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByRole('status')).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
})

test('unauthorized customer list 401 clears prior customers and requires a fresh authorized read',async({page})=>{
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  // A session expiry on the list must also invalidate an already-open detail card.
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Баланс: 101 бонусов')
  await page.route('**/crm/customers?**',route=>route.fulfill({
    status:401,contentType:'application/json',body:JSON.stringify({error:'unauthorized'})
  }))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(section.getByRole('status')).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
})

test('permission denied on list refresh closes an already open customer card',async({page})=>{
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toContainText('Баланс: 101 бонусов')
  await page.route('**/crm/customers?**',route=>route.fulfill({
    status:403,contentType:'application/json',body:JSON.stringify({error:'forbidden'})
  }))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(section.getByRole('region',{name:'Карточка клиента'})).toHaveCount(0)
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
})

test('malformed customer list HTTP 200 cannot masquerade as an empty CRM',async({page})=>{
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  // HTTP success alone does not prove that a scoped, paginated list was returned.
  await page.route('**/crm/customers?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({customers:[],total:0})
  }))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByRole('status')).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
})

test('malformed list response closes an open card without presenting an empty database',async({page})=>{
  await login(page,'root')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card).toContainText('Баланс: 101 бонусов')
  // A malformed HTTP 200 must revoke both the list and its previously verified detail.
  await page.route('**/crm/customers?**',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({customers:[],total:0})
  }))
  await section.getByRole('button',{name:'Обновить',exact:true}).click()
  await expect(section.getByRole('alert')).toBeVisible()
  await expect(card).toHaveCount(0)
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(0)
  await expect(section.getByText('Клиентов пока нет.',{exact:true})).toHaveCount(0)
  await page.unroute('**/crm/customers?**')
  await section.getByRole('button',{name:'Повторить проверку',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await expect(card).toHaveCount(0)
})

test('malformed customer detail response fails closed and fresh retry recovers',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  // A successful HTTP status does not establish a valid scoped CRM envelope.
  await page.route('**/crm/customers/1',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({customer:{id:'1'},wallet:{balance:'101'}})
  }))
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toContainText('Не удалось подтвердить данные этого заведения.')
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('status')).toHaveCount(0)
  await card.getByRole('button',{name:'Закрыть карточку',exact:true}).click()
  await page.unroute('**/crm/customers/1')
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('expired session on customer detail hides money and recovers only after a fresh read',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers/1',route=>route.fulfill({
    status:401,contentType:'application/json',body:JSON.stringify({error:'unauthorized'})
  }))
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toContainText('Сессия истекла. Войдите снова.')
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('status')).toHaveCount(0)
  await card.getByRole('button',{name:'Закрыть карточку',exact:true}).click()
  await page.unroute('**/crm/customers/1')
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('denied customer detail never exposes a cached balance',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers/1',route=>route.fulfill({
    status:403,contentType:'application/json',body:JSON.stringify({error:'forbidden'})
  }))
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toContainText('Проверка недоступна или у вас нет доступа')
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('status')).toHaveCount(0)
  await card.getByRole('button',{name:'Закрыть карточку',exact:true}).click()
  await expect(card).toHaveCount(0)
  // Permission recovery must fetch actual scoped detail, not reuse the 403 state.
  await page.unroute('**/crm/customers/1')
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
})



test('missing customer detail 404 never invents a balance and recovers',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers/1',route=>route.fulfill({
    status:404,contentType:'application/json',body:JSON.stringify({error:'not_found'})
  }))
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('status')).toHaveCount(0)
  await card.getByRole('button',{name:'Закрыть карточку',exact:true}).click()
  await page.unroute('**/crm/customers/1')
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('rate-limited customer detail never exposes money and recovers on retry',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers/1',route=>route.fulfill({
    status:429,contentType:'application/json',body:JSON.stringify({error:'rate_limited'})
  }))
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('status')).toHaveCount(0)
  await card.getByRole('button',{name:'Закрыть карточку',exact:true}).click()
  await page.unroute('**/crm/customers/1')
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
})

test('customer detail server failure hides money and recovers on fresh request',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  await page.route('**/crm/customers/1',route=>route.fulfill({
    status:500,contentType:'application/json',body:JSON.stringify({error:'internal_error'})
  }))
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await card.getByRole('button',{name:'Закрыть карточку',exact:true}).click()
  await page.unroute('**/crm/customers/1')
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
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
  // The final partial page must navigate back without losing the server total or rows.
  await section.getByRole('button',{name:'Назад',exact:true}).click()
  await expect(section.getByText('Страница 14',{exact:true})).toBeVisible()
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(25)
  await expect(section.getByRole('status')).toContainText('Найдено клиентов: 355.')
  await section.getByRole('button',{name:'Далее',exact:true}).click()
  await expect(section.getByText('Страница 15',{exact:true})).toBeVisible()
  await expect(section.locator('.tenant-crm-list button')).toHaveCount(5)
  await expect(section.getByRole('button',{name:'Далее',exact:true})).toBeDisabled()
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
  // Wait for server-side session revocation before the next navigation: the
  // previous mobile trace showed logout aborted by page.goto('/') and the old
  // session restored on /auth/session. Do not weaken the cross-owner 404 check.
  const logoutResponse=page.waitForResponse(response=>response.url().endsWith('/api/admin/auth/logout')&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Выйти',exact:true}).click()
  expect((await logoutResponse).ok()).toBe(true)
  // Logout must render the guest login form before another owner's session starts.
  // Keep the assertion explicit: a missing form is an auth regression, not a reason to skip isolation checks.
  await expect(page.getByLabel('Email',{exact:true})).toBeVisible()
  await login(page,'owner')
  expect((await page.request.get(`/api/admin/onboarding/drafts/${foreign.id}/crm/customers`)).status()).toBe(404)
  await expect(page.getByRole('button',{name:'Открыть черновик CRM 3',exact:true})).toHaveCount(0)
})

test('late real customer response cannot reopen a card from the previous venue',async({page})=>{
  // The trace on 6ccb8d6 shows owner exhausted the real 30/min read guard (429),
  // including the CRM 2 list. Use the less-loaded root fixture for this race on
  // both projects; never weaken the server guard or mask a 429 as an empty list.
  await login(page,'root')
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

test('late customer list from a closed venue never appears in the next venue',async({page})=>{
  await login(page,'root')
  const first=await open(page,'CRM 1')
  let release!:()=>void
  const pending=new Promise<void>(resolve=>{release=resolve})
  let received!:()=>void
  const arrived=new Promise<void>(resolve=>{received=resolve})
  let firstListUrl=''
  await page.route('**/crm/customers?**',async route=>{
    if(!route.request().url().includes('/crm/customers?'))return route.continue()
    firstListUrl=route.request().url()
    const response=await route.fetch()
    received()
    await pending
    await route.fulfill({response}).catch(()=>undefined)
  })
  await first.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await arrived
  // Stop intercepting new requests before opening CRM 2. The already
  // intercepted CRM 1 response stays blocked until release() below.
  await page.unroute('**/crm/customers?**')
  await page.getByRole('button',{name:'Закрыть',exact:true}).click()
  const second=await open(page,'CRM 2')
  release()
  // Capture the actual second-venue HTTP status to distinguish rate limiting
  // from a stale-response UI regression in the failing browser scenario.
  const secondListResponse=page.waitForResponse(response=>
    response.url().includes('/crm/customers?') && response.url()!==firstListUrl && response.request().method()==='GET'
  )
  await second.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  const response=await secondListResponse
  expect(response.status(),`CRM 2 list HTTP ${response.status()} at ${new URL(response.url()).pathname}`).toBe(200)
  await expect(second.getByRole('button',{name:'Owned 102 бонусов',exact:true})).toBeVisible()
  await expect(second.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toHaveCount(0)
  await expect(second.getByRole('status')).toContainText('Найдено клиентов:')
})

test('failed customer detail can retry in place without showing unverified money',async({page})=>{
  await login(page,'owner')
  const section=await open(page,'CRM 1')
  await section.getByRole('button',{name:'Проверить клиентскую базу',exact:true}).click()
  await expect(section.getByRole('button',{name:'Owned 101 бонусов',exact:true})).toBeVisible()
  let attempts=0
  await page.route('**/crm/customers/1',route=>{
    attempts++
    if(attempts===1)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'internal_error'})})
    return route.continue()
  })
  await section.getByRole('button',{name:'Owned 101 бонусов',exact:true}).click()
  const card=section.getByRole('region',{name:'Карточка клиента'})
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(card).not.toContainText('Баланс: 101 бонусов')
  await card.getByRole('button',{name:'Повторить проверку карточки',exact:true}).click()
  // The retry action disappears while the next scoped read is pending.
  await expect(card.getByRole('button',{name:'Повторить проверку карточки',exact:true})).toHaveCount(0)
  await expect(card).toContainText('Баланс: 101 бонусов')
  await expect(card.getByRole('alert')).toHaveCount(0)
  expect(attempts).toBe(2)
})
