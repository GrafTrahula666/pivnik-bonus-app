import { defineConfig } from '@playwright/test'

const proxyServer=process.env.HTTPS_PROXY||process.env.https_proxy||''

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.ADMIN_E2E_BASE_URL || 'http://127.0.0.1:5173',
    ...(proxyServer?{proxy:{server:proxyServer}}:{}),
    ignoreHTTPSErrors:Boolean(proxyServer),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
