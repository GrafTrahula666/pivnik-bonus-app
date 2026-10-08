import { defineConfig } from '@playwright/test'
export default defineConfig({testDir:'./e2e',testMatch:'evotor-sales.spec.ts',timeout:30000,retries:0,
 use:{baseURL:'http://127.0.0.1:5173',trace:'retain-on-failure',screenshot:'only-on-failure'},
 webServer:{command:'npm run dev:web -- --host 127.0.0.1 --port 5173 --strictPort',url:'http://127.0.0.1:5173/e2e/fixtures/evotor.html',reuseExistingServer:false},
 projects:[{name:'desktop',use:{viewport:{width:1440,height:1000}}},{name:'mobile',use:{viewport:{width:390,height:844}}}]})
