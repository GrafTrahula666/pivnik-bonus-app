import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {ProductionDashboard} from '../phaseC/ProductionDashboard'
import {apiGet,type ApiVenue} from '../api'
vi.mock('../api',async()=>({...await vi.importActual('../api'),apiGet:vi.fn()}))

const venue:ApiVenue={id:'test-1',companyId:'one',companyName:'Test Company',companyCode:'pivnik',code:'pivnik',name:'Test Venue',address:null,legacyBarId:'1'}
const metric=(value:number|null)=>({available:value!==null,value,source:'synthetic fixture'})
const values={
  trackedRevenue:metric(1234),checkCount:metric(4),averageCheck:metric(308),
  totalCustomers:metric(20),newCustomers:metric(2),activeCustomers:metric(4),
  returningCustomers:metric(2),bonusEarned:metric(50),bonusRedeemed:metric(10),
  outstandingBonusBalance:metric(400),visits:metric(null),redemptionRate:metric(20),
  operationCount:metric(5),
}
const dashboard={
  period:{from:'2026-10-09T21:00:00.000Z',to:'2026-10-10T21:00:00.000Z',days:1},
  metrics:values,previousMetrics:{trackedRevenue:500,checkCount:2,transactionActiveCustomers:2,averageCheck:250,operationCount:2},
  trend:[{day:'2026-10-10',revenue:1234,checks:4,operations:5,customers:4,bonusEarned:50,bonusRedeemed:10}],
  hourly:[{hour:12,revenue:1234,checks:4,operations:5,customers:4,bonusEarned:50,bonusRedeemed:10}],
  platformSplit:{vk:8,telegram:9,both:0,unknown:3,note:'fixture'},
  unavailableMetrics:[{key:'visits',reason:'No event',requiredEvent:'visit_started'}],
  dataSource:{legacyBarId:'1',accountMode:'separate'},
}
let node:HTMLDivElement,root:Root
async function click(label:string){
  const button=[...node.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)
  expect(button,'button '+label).toBeTruthy()
  await act(async()=>button!.click())
}
async function setDate(label:string,value:string){
  const input=node.querySelector('input[aria-label="'+label+'"]') as HTMLInputElement
  expect(input).toBeTruthy()
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value)
    input.dispatchEvent(new Event('input',{bubbles:true}))
    input.dispatchEvent(new Event('change',{bubbles:true}))
  })
}
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
  vi.mocked(apiGet).mockReset()
  vi.mocked(apiGet).mockImplementation(async path=>path.includes('/dashboard/operations?')?dashboard as never:{} as never)
  node=document.createElement('div');document.body.append(node);root=createRoot(node)
})
afterEach(async()=>{await act(async()=>root.unmount());node.remove();vi.useRealTimers()})
describe('app operations time controls use own data source, never POS',()=>{
  it('selects yesterday, 14 days, arbitrary day and a custom inclusive interval',async()=>{
    await act(async()=>root.render(createElement(ProductionDashboard,{venue,period:'30 дней',compare:false,onNavigate:()=>{}})))
    await click('Операции приложения')
    expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/test-1/dashboard/operations?days=30')
    expect(node.textContent).toContain('Сумма операций приложения')
    await click('Вчера')
    expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/test-1/dashboard/operations?date=2026-10-09')
    await click('14 дней')
    expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/test-1/dashboard/operations?days=14')
    await setDate('Дата операций приложения','2026-10-02')
    expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/test-1/dashboard/operations?date=2026-10-02')
    await setDate('Начало периода операций','2026-09-30')
    await setDate('Конец периода операций','2026-10-03')
    await click('Показать период')
    expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/test-1/dashboard/operations?from=2026-09-30&to=2026-10-03')
    expect(vi.mocked(apiGet).mock.calls.filter(([path])=>path.includes('/dashboard/operations?')).length).toBeGreaterThanOrEqual(5)
  })
  it('does not request an invalid operation range and resets validation on a preset URL',async()=>{
    await act(async()=>root.render(createElement(ProductionDashboard,{venue,period:'30 дней',compare:false,onNavigate:()=>{}})))
    await click('Операции приложения')
    await setDate('Начало периода операций','2026-10-09')
    await setDate('Конец периода операций','2026-10-08')
    const count=vi.mocked(apiGet).mock.calls.length
    await click('Показать период')
    expect(vi.mocked(apiGet)).toHaveBeenCalledTimes(count)
    expect(node.querySelector('[role="alert"]')?.textContent).toContain('Начало периода')
    await click('7 дней')
    expect(apiGet).toHaveBeenLastCalledWith('/api/admin/venues/test-1/dashboard/operations?days=7')
    expect(node.querySelector('[role="alert"]')).toBeNull()
  })
  it('keeps six owner-critical period KPIs visible and seven secondary metrics accessible',async()=>{
    await act(async()=>root.render(createElement(ProductionDashboard,{venue,period:'7 дней',compare:false,onNavigate:()=>{}})))
    await click('Операции приложения')
    const primary=node.querySelector('[aria-label="Основные показатели операций"]')
    expect(primary).toBeTruthy()
    const cards=[...primary!.querySelectorAll('.live-kpi')]
    expect(cards).toHaveLength(6)
    expect(cards.map(card=>card.querySelector('.kpi-top span')?.textContent)).toEqual([
      'Сумма операций приложения','Записей о покупках','Операций в журнале',
      'Клиентов с операциями','Новых клиентов (регистрация)','Средняя сумма записи',
    ])
    expect(cards[2].textContent).toContain('150%')
    expect(cards[3].textContent).toContain('100%')
    expect(cards[0].textContent).toContain('146,8%')
    expect(node.textContent).toContain('не по установке приложения и не по первой покупке')
    const extra=node.querySelector('[aria-label="Дополнительные показатели операций"]') as HTMLElement
    expect(extra).toBeTruthy()
    expect(extra.tagName).toBe('SECTION')
    expect(extra.querySelectorAll('.app-operations-secondary-row')).toHaveLength(7)
    expect(node.querySelector('details.app-operations-extra')).toBeNull()
    expect(extra.textContent).toContain('Клиентов всего')
    expect(extra.textContent).toContain('Посещений')
    expect(extra.textContent).toContain('Нет данных')
    expect(extra.textContent).toContain('Бонусы в обращении')
    expect(extra.textContent).toContain('Без сравнения с прошлым периодом')
  })
  it('distinguishes falling, rising and flat operation metrics without falsely showing growth',async()=>{
    const modified={...dashboard,metrics:{...values,trackedRevenue:metric(250),checkCount:metric(2),activeCustomers:metric(3)}}
    vi.mocked(apiGet).mockImplementation(async path=>path.includes('/dashboard/operations?')?modified as never:{} as never)
    await act(async()=>root.render(createElement(ProductionDashboard,{venue,period:'7 дней',compare:false,onNavigate:()=>{}})))
    await click('Операции приложения')
    const cards=[...node.querySelectorAll('[aria-label="Основные показатели операций"] .live-kpi')]
    expect(cards).toHaveLength(6)
    const down=cards[0].querySelector('.delta')!
    expect(down.textContent).toContain('−50%')
    expect(down.classList.contains('negative')).toBe(true)
    expect(down.querySelector('svg')).toBeTruthy()
    const flat=cards[1].querySelector('.delta')!
    expect(flat.textContent).toContain('0%')
    expect(flat.querySelector('svg')).toBeNull()
    expect(flat.classList.contains('negative')).toBe(false)
    const up=cards[3].querySelector('.delta')!
    expect(up.textContent).toContain('+50%')
    expect(up.querySelector('svg')).toBeTruthy()
    expect(up.classList.contains('negative')).toBe(false)
  })
  it('toggles hourly/day trends and preserves unavailable visits without inventing activity',async()=>{
    await act(async()=>root.render(createElement(ProductionDashboard,{venue,period:'7 дней',compare:false,onNavigate:()=>{}})))
    await click('Операции приложения')
    const selector=node.querySelector('[aria-label="Группировка операций"]')!
    expect(selector.querySelector('[aria-pressed="true"]')?.textContent).toBe('По дням')
    await click('По часам')
    expect(selector.querySelector('[aria-pressed="true"]')?.textContent).toBe('По часам')
    expect(node.textContent).toContain('Сумма по одинаковым часам')
    await click('Операции')
    expect(node.textContent).toContain('Клиенты VK')
    await click('Посещения')
    expect(node.textContent).toContain('Пока недостаточно данных')
    const compare=node.querySelector('input[aria-label="Сравнить операции с предыдущим периодом"]') as HTMLInputElement
    expect(compare).toBeTruthy()
    await act(async()=>compare.click())
    expect(node.textContent).toContain('Всего операций')
  })
})
