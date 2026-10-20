import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./e2e',testMatch:/onboarding-(invitations|pos-proxy)\.spec\.ts/,timeout:60_000,retries:0,workers:1,
  use:{baseURL:'http://127.0.0.1:5097',actionTimeout:10_000,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run build && node --import tsx e2e/fixtures/onboarding-server.ts',url:'http://127.0.0.1:5097',
    env:{SPACEVERSE_E2E_INVITATIONS:'true',SPACEVERSE_E2E_WORKFLOW:'true',SPACEVERSE_E2E_POS_PROXY:'true'},reuseExistingServer:false,timeout:120_000},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
})
