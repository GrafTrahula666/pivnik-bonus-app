import {defineConfig} from '@playwright/test'

// Only synthetic, loopback-only onboarding fixture. Explicit opt-in is scoped
// to the separate browser test process; production remains feature-flag OFF.
export default defineConfig({
  testDir:'./e2e',testMatch:'tenant-crm-contact.spec.ts',timeout:50_000,retries:0,workers:1,
  use:{baseURL:'http://127.0.0.1:5097',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{
    command:'npm run build && SPACEVERSE_E2E_CRM_CONTACTS=true node --import tsx e2e/fixtures/onboarding-server.ts',
    url:'http://127.0.0.1:5097',reuseExistingServer:false,timeout:120_000,
  },
  projects:[
    {name:'desktop',use:{viewport:{width:1440,height:960}}},
    {name:'mobile',use:{viewport:{width:390,height:844},isMobile:true,hasTouch:true}},
  ],
})
