import {expect,test,type BrowserContext,type Page} from '@playwright/test'

const baseUrl=process.env.ADMIN_E2E_BASE_URL||''
const email=process.env.ADMIN_E2E_SUPER_EMAIL||''
const password=process.env.ADMIN_E2E_SUPER_PASSWORD||''
type StoredState=Awaited<ReturnType<BrowserContext['storageState']>>
let state:StoredState|undefined

type Observation={consoleErrors:string[];pageErrors:string[];failedRequests:string[];badResponses:string[];reactWarnings:string[]}
function observe(page:Page):Observation{
  const r:Observation={consoleErrors:[],pageErrors:[],failedRequests:[],badResponses:[],reactWarnings:[]}
  page.on('console',m=>{const u=m.location().url||'';if(u.startsWith('chrome-extension://'))return;if(m.type()==='error')r.consoleErrors.push(`${m.text()} @ ${u||'inline'}`);if(m.type()==='warning'&&/react|warning|recharts/i.test(m.text()))r.reactWarnings.push(m.text())})
  page.on('pageerror',e=>r.pageErrors.push(e.stack||e.message))
  page.on('requestfailed',q=>r.failedRequests.push(`${q.method()} ${q.url()} :: ${q.failure()?.errorText||'unknown'}`))
  page.on('response',s=>{if(s.url().startsWith(baseUrl)&&s.status()>=400)r.badResponses.push(`${s.status()} ${s.request().method()} ${s.url()}`)})
  return r
}
function clean(r:Observation){expect(r.consoleErrors).toEqual([]);expect(r.pageErrors).toEqual([]);expect(r.failedRequests).toEqual([]);expect(r.badResponses).toEqual([]);expect(r.reactWarnings).toEqual([])}

async function openDashboard(page:Page){
  const select=page.locator('.tenant-select')
  const option=select.locator('option').filter({hasText:'ПИВНИК TEST · ПИВНИК TEST VENUE'})
  await expect(option).toHaveCount(1)
  await select.selectOption(await option.getAttribute('value')||'')
  const menu=page.locator('.mobile-menu')
  const sidebar=page.locator('.sidebar')
  if(await menu.isVisible()){
    await menu.click()
    await expect(sidebar).toHaveClass(/open/)
  }
  await sidebar.getByRole('button',{name:'Обзор',exact:true}).click()
  await expect(page.getByRole('heading',{name:'ПИВНИК TEST VENUE',exact:true}).first()).toBeVisible()
  await expect(page.locator('.kpi-grid')).toBeVisible()
}

test.beforeAll(async({browser})=>{
  if(!baseUrl||!email||!password)throw new Error('Small responsive proof credentials are incomplete')
  const context=await browser.newContext({baseURL:baseUrl})
  const page=await context.newPage()
  await page.goto('/',{waitUntil:'domcontentloaded'})
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button',{name:'Войти'}).click()
  await expect(page.locator('.app-shell')).toBeVisible()
  state=await context.storageState()
  await context.close()
})

for(const [label,width,height] of [['tablet 768×1024',768,1024],['mobile 390×844',390,844]] as const){
  test(label,async({browser})=>{
    if(!state)throw new Error('Authenticated storage state missing')
    const context=await browser.newContext({baseURL:baseUrl,storageState:state,viewport:{width,height}})
    const page=await context.newPage()
    const failures=observe(page)
    try{
      await page.goto('/',{waitUntil:'domcontentloaded'})
      await expect(page.locator('.app-shell')).toBeVisible()
      await openDashboard(page)
      const d=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}))
      console.log(`SMALL_RESPONSIVE_PROOF ${label} client=${d.clientWidth} scroll=${d.scrollWidth} overflow=${d.scrollWidth-d.clientWidth}`)
      expect(d.scrollWidth-d.clientWidth).toBeLessThanOrEqual(1)
      clean(failures)
    }finally{await context.close()}
  })
}
