import { expect, test, type Page } from '@playwright/test'

// Synthetic list/detail HTTP fixtures verify UI behavior, not real tenant integration.
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
const customer = (scope: string, n: number) => ({
  id: String(n), name: `Гость ${scope}-${n}`, username: null, registeredAt: '2026-10-01T12:00:00Z',
  membershipStatus: 'active', balance: 0, lifetimeSpend: 100, averageCheck: 100, operationCount: 1,
  lastActivityAt: '2026-10-01T12:00:00Z', bonusEarned: 0, bonusRedeemed: 0, platform: 'unknown',
  level: 'Начальный', cashbackPercent: 0, visitCount: null, visitCountReason: '', segment: 'new',
  maxCheck: 100, firstActivityAt: null, paidMlTotal: 0, giftMlBalance: 0, identities: [], timeline: [],
  achievements: [], wheelHistory: [], shopPurchases: [],
})
async function app(page: Page, options: { delayed?: ReturnType<typeof gate>; failSecond?: boolean } = {}) {
  const requests: URL[] = []
  let fail = options.failSecond
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url())
    const match = /\/venues\/(\d+)\/clients(?:\/(segments|\d+))?$/.exec(url.pathname)
    if (!match) return route.fulfill({ status: 503, json: { error: 'Synthetic fixture only' } })
    const [, scope, child] = match
    if (child === 'segments') return route.fulfill({ json: { segments: { new: 150, regular: 55, active: 0, lapsing: 0, gone: 0, never: 0 } } })
    if (child) return route.fulfill({ json: customer(scope!, Number(child)) })
    requests.push(url)
    const offset = Number(url.searchParams.get('offset'))
    const limit = Number(url.searchParams.get('limit'))
    if (offset === 100 && scope === '101') {
      await options.delayed?.promise
      if (fail) { fail = false; return route.fulfill({ status: 503, json: { error: 'Тестовая ошибка страницы' } }) }
    }
    const q = url.searchParams.get('q')
    const total = q === 'empty' ? 0 : q ? 2 : url.searchParams.get('segment') ? 150 : 205
    return route.fulfill({ json: { total, limit, offset,
      rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => customer(scope!, offset + i + 1)) } })
  })
  await page.goto('/e2e/fixtures/crm-pagination.html')
  await expect(page.locator('tbody tr')).toHaveCount(100)
  return requests
}
const next = (page: Page) => page.getByRole('button', { name: 'Далее', exact: true })
const previous = (page: Page) => page.getByRole('button', { name: 'Назад', exact: true })
const status = (page: Page) => page.getByRole('status')

test('all 205 customers are reachable without duplicate rows; drawer still opens', async ({ page }) => {
  const requests = await app(page)
  const names: string[] = []
  await expect(previous(page)).toBeDisabled()
  for (const range of ['1–100 из 205', '101–200 из 205', '201–205 из 205']) {
    await expect(status(page)).toHaveText(range)
    names.push(...await page.locator('tbody .person b').allTextContents())
    if (range !== '201–205 из 205') await next(page).click()
  }
  expect(names).toHaveLength(205)
  expect(new Set(names).size).toBe(205)
  await expect(next(page)).toBeDisabled()
  await page.getByText('Гость 101-205', { exact: true }).click()
  await expect(page.locator('.drawer h2')).toHaveText('Гость 101-205')
  await page.locator('.drawer-head button').click()
  await previous(page).click()
  await expect(status(page)).toHaveText('101–200 из 205')
  expect(requests.map(url => url.searchParams.get('offset'))).toEqual(['0', '100', '200', '100'])
  expect(requests.every(url => url.searchParams.get('limit') === '100')).toBe(true)
})

test('search, sort and segment changes reset the page and empty results disable paging', async ({ page }) => {
  const requests = await app(page)
  await next(page).click()
  await expect(status(page)).toHaveText('101–200 из 205')
  await page.getByRole('combobox', { name: 'Сортировка клиентов' }).selectOption('spend')
  await expect(status(page)).toHaveText('1–100 из 205')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  expect(requests.at(-1)?.searchParams.get('sort')).toBe('spend')
  await next(page).click()
  await expect(status(page)).toHaveText('101–200 из 205')
  await page.getByRole('button', { name: /^Новые/ }).click()
  await expect(status(page)).toHaveText('1–100 из 150')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  await next(page).click()
  await expect(status(page)).toHaveText('101–150 из 150')
  await page.getByPlaceholder('Имя, @ник или ID клиента…').fill('needle')
  await expect(status(page)).toHaveText('1–2 из 2')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  await page.getByPlaceholder('Имя, @ник или ID клиента…').fill('empty')
  await expect(status(page)).toHaveText('0–0 из 0')
  await expect(previous(page)).toBeDisabled()
  await expect(next(page)).toBeDisabled()
})

test('pending page cannot duplicate requests and a late response cannot replace a new filter', async ({ page }) => {
  const delayed = gate()
  await app(page, { delayed })
  await next(page).click()
  await expect(status(page)).toHaveText('Загрузка страницы…')
  await expect(next(page)).toBeDisabled()
  await expect(previous(page)).toBeDisabled()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.getByPlaceholder('Имя, @ник или ID клиента…').fill('needle')
  await expect(status(page)).toHaveText('1–2 из 2')
  const oldResponse = page.waitForResponse(r => new URL(r.url()).searchParams.get('offset') === '100')
  delayed.release()
  await (await oldResponse).finished()
  await expect(status(page)).toHaveText('1–2 из 2')
  await expect(page.locator('tbody tr')).toHaveCount(2)
})

test('column sorting resets paging and retains direction on the next page', async ({ page }) => {
  const requests = await app(page)
  await next(page).click()
  await expect(status(page)).toHaveText('101–200 из 205')
  const balanceHeader = page.getByRole('columnheader', { name: /Баланс/ })
  await balanceHeader.getByRole('button').click()
  await expect(status(page)).toHaveText('1–100 из 205')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  expect(requests.at(-1)?.searchParams.get('sort')).toBe('balance')
  expect(requests.at(-1)?.searchParams.get('direction')).toBe('desc')
  await next(page).click()
  await expect(status(page)).toHaveText('101–200 из 205')
  expect(requests.at(-1)?.searchParams.get('direction')).toBe('desc')
  await balanceHeader.getByRole('button').click()
  await expect(status(page)).toHaveText('1–100 из 205')
  expect(requests.at(-1)?.searchParams.get('direction')).toBe('asc')
  await expect(balanceHeader).toHaveAttribute('aria-sort', 'ascending')
})

for (const scope of ['102', '201']) test(`scope ${scope} resets paging and rejects late previous-scope data`, async ({ page }) => {
  const delayed = gate()
  const requests = await app(page, { delayed })
  await next(page).click()
  await expect(status(page)).toHaveText('Загрузка страницы…')
  await page.getByRole('combobox', { name: 'Тестовое заведение' }).selectOption(scope)
  await expect(status(page)).toHaveText('1–100 из 205')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  const oldResponse = page.waitForResponse(r => new URL(r.url()).searchParams.get('offset') === '100')
  delayed.release()
  await (await oldResponse).finished()
  await expect(page.getByText(`Гость ${scope}-1`, { exact: true })).toHaveCount(1)
  await expect(page.getByText('Гость 101-101', { exact: true })).toHaveCount(0)
})

test('a failed page offers retry and cannot advance until recovery', async ({ page }) => {
  await app(page, { failSecond: true })
  await next(page).click()
  await expect(page.getByText('Тестовая ошибка страницы', { exact: true })).toBeVisible()
  await expect(next(page)).toBeDisabled()
  await expect(previous(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(status(page)).toHaveText('101–200 из 205')
  await expect(next(page)).toBeEnabled()
})
