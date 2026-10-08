import fs from 'node:fs/promises'
import { chromium, expect, type FullConfig } from '@playwright/test'
import { authDir, stateFile } from './auth-state'

export default async function globalSetup(config:FullConfig){
  const accounts=[
    [process.env.ADMIN_E2E_SUPER_EMAIL,process.env.ADMIN_E2E_SUPER_PASSWORD],
    [process.env.ADMIN_E2E_VENUE_EMAIL,process.env.ADMIN_E2E_VENUE_PASSWORD],
    [process.env.ADMIN_E2E_NORTH_EMAIL,process.env.ADMIN_E2E_NORTH_PASSWORD],
  ].filter((pair):pair is [string,string]=>Boolean(pair[0]&&pair[1]))
  const use=config.projects[0]?.use||{}
  const baseURL=use.baseURL
  if(!baseURL||!accounts.length)return

  await fs.rm(authDir,{recursive:true,force:true})
  await fs.mkdir(authDir,{recursive:true})
  const browser=await chromium.launch(use.launchOptions)
  try{
    for(const [email,password] of accounts){
      const context=await browser.newContext({baseURL,proxy:use.proxy,ignoreHTTPSErrors:use.ignoreHTTPSErrors})
      const page=await context.newPage()
      await page.goto('/',{waitUntil:'domcontentloaded'})
      await expect(page.getByRole('heading',{name:'Вход в панель управления'})).toBeVisible()
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Пароль').fill(password)
      await page.getByRole('button',{name:'Войти'}).click()
      await expect(page.locator('.app-shell')).toBeVisible()
      await context.storageState({path:stateFile(email)})
      await context.close()
    }
  }finally{
    await browser.close()
  }
}
