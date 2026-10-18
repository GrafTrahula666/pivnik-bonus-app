import { expect, test, type Page } from '@playwright/test'

// Browser-only fixtures for existing UI contracts. These do not enable the
// production tenant reader, authenticate real accounts or call provider APIs.
const venues = [
  { id: '101', companyId: '10', companyCode: 'pivnik', companyName: 'Компания A', code: 'a-one', name: 'Точка A1', address: null, legacyBarId: '1', accessKind: 'owner' },
  { id: '102', companyId: '10', companyCode: 'pivnik', companyName: 'Компания A', code: 'a-two', name: 'Точка A2', address: null, legacyBarId: '2', accessKind: 'owner' },
  { id: '201', companyId: '20', companyCode: 'beta', companyName: 'Компания B', code: 'b-one', name: 'Точка B1', address: null, legacyBarId: null, accessKind: 'owner' },
]
const customer = (venueId: string) => ({
  id: venueId, name: `Клиент точки ${venueId}`, username: null, registeredAt: '2026-10-01T12:00:00Z',
  membershipStatus: 'active', balance: 0, lifetimeSpend: 100, averageCheck: 100, operationCount: 1,
  lastActivityAt: '2026-10-01T12:00:00Z', bonusEarned: 0, bonusRedeemed: 0, platform: 'unknown',
  level: 'Начальный', cashbackPercent: 0, visitCount: null, visitCountReason: 'Нет событий посещения',
  segment: 'new', maxCheck: 100, firstActivityAt: '2026-10-01T12:00:00Z', paidMlTotal: 0,
  giftMlBalance: 0, identities: [], timeline: [], achievements: [], wheelHistory: [], shopPurchases: [],
})

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function app(page: Page, options: { slowList?: string; listGate?: ReturnType<typeof gate>; detailGate?: ReturnType<typeof gate> } = {}) {
  await page.route('**/api/admin/**', async route => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/admin/auth/session') return route.fulfill({ json: {
      admin: { id: '11', email: 'owner@fixture.invalid', displayName: 'Тестовый владелец', role: 'VENUE_ADMIN' },
      csrfToken: 'fixture-only', capabilities: { writes: false, productionBonusWrites: false,
        productionAchievementWrites: false, productionEntitlementWrites: false, demo: false },
    } })
    if (url.pathname === '/api/admin/venues') return route.fulfill({ json: { venues } })
    const clients = /^\/api\/admin\/venues\/(101|102|201)\/clients(?:\/(segments|\d+))?$/.exec(url.pathname)
    if (clients) {
      const [, venueId, child] = clients
      if (!child) {
        if (venueId === options.slowList) await options.listGate?.promise
        if (venueId === '201') return route.fulfill({ status: 409, json: {
          error: 'Клиентский источник этой компании ещё не подключён', code: 'LEGACY_ADAPTER_NOT_TENANT_SAFE',
        } })
        return route.fulfill({ json: { total: 1, rows: [customer(venueId!)] } })
      }
      if (child === 'segments') return route.fulfill({ json: { segments: { new: 1, regular: 0, active: 0, lapsing: 0, gone: 0, never: 0 } } })
      if (child !== venueId) return route.fulfill({ status: 404, json: { error: 'Клиент другой точки недоступен', code: 'CUSTOMER_NOT_FOUND' } })
      if (venueId === '101') await options.detailGate?.promise
      return route.fulfill({ json: customer(venueId!) })
    }
    return route.fulfill({ status: 503, json: { error: 'Источник не настроен в браузерной фикстуре' } })
  })
  await page.goto('/')
  await expect(page.locator('.tenant-select')).toHaveValue('101')
  if (await page.locator('.mobile-menu').isVisible()) await page.locator('.mobile-menu').click()
  await page.getByRole('button', { name: 'Клиенты', exact: true }).click()
  await expect(page.getByText('Клиент точки 101', { exact: true })).toBeVisible()
}

for (const [target, label] of [['102', 'another venue in the same company'], ['201', 'another company']] as const) {
  test(`CRM clears table and drawer immediately when switching to ${label}`, async ({ page }, info) => {
    const nextList = gate()
    await app(page, { slowList: target, listGate: nextList })
    await page.getByText('Клиент точки 101', { exact: true }).click()
    await expect(page.locator('.drawer h2')).toHaveText('Клиент точки 101')
    try {
      await page.locator('.tenant-select').selectOption(target)
      await expect(page.getByText('Клиент точки 101', { exact: true })).toHaveCount(0)
      await expect(page.locator('.drawer')).toHaveCount(0)
      await expect(page.getByText('Загрузка реальных данных…', { exact: true })).toBeVisible()
    } finally {
      nextList.release()
    }
    if (target === '201') {
      await expect(page.getByText('Клиентский источник этой компании ещё не подключён', { exact: true })).toBeVisible()
      await expect(page.getByText('Клиент точки 101', { exact: true })).toHaveCount(0)
    } else await expect(page.getByText(`Клиент точки ${target}`, { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`crm-scope-${target}.png`), fullPage: true })
  })
}

test('a delayed customer response cannot reopen data from the previous scope', async ({ page }) => {
  const oldDetail = gate()
  await app(page, { detailGate: oldDetail })
  await page.getByText('Клиент точки 101', { exact: true }).click()
  await expect(page.locator('.drawer h2')).toHaveText('Загрузка…')
  await page.locator('.tenant-select').selectOption('102')
  await expect(page.getByText('Клиент точки 102', { exact: true })).toBeVisible()
  const previousResponse = page.waitForResponse(response => response.url().endsWith('/venues/101/clients/101'))
  oldDetail.release()
  await (await previousResponse).finished()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(page.getByText('Клиент точки 101', { exact: true })).toHaveCount(0)
  await expect(page.locator('.drawer')).toHaveCount(0)
})
