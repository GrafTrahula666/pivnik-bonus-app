import {defineConfig} from '@playwright/test'

export default defineConfig({
  testDir:'./e2e',testMatch:process.env.SPACEVERSE_E2E_DATABASE_CAPACITY_EMPTY==='true'?'tenant-database-capacity-empty.spec.ts':
    process.env.SPACEVERSE_E2E_DATABASE_BOOTSTRAP==='true'||process.env.SPACEVERSE_E2E_DATABASE_CAPACITY==='true'?'tenant-database-bootstrap.spec.ts':
    process.env.SPACEVERSE_E2E_SUPPORT==='true'?'onboarding-support.spec.ts':
    process.env.SPACEVERSE_E2E_OWNER_SEARCH==='true'?'owner-venue-search.spec.ts':
    process.env.SPACEVERSE_E2E_CRM_PREPARATION==='true'?'crm-preparation.spec.ts':
    process.env.SPACEVERSE_E2E_CRM_ACTIVATION==='true'?'tenant-crm-activation.spec.ts':
    process.env.SPACEVERSE_E2E_CRM_READS==='false'?'tenant-crm-disabled.spec.ts':'tenant-crm.spec.ts',timeout:45_000,retries:0,workers:1,
  use:{baseURL:'http://127.0.0.1:5101',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run build && node --import tsx e2e/fixtures/tenant-crm-server.ts',
    url:'http://127.0.0.1:5101',reuseExistingServer:false,timeout:120_000},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
})
