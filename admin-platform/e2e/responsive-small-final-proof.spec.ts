import {expect,test,type BrowserContext,type Page} from '@playwright/test'

const baseUrl=process.env.ADMIN_E2E_BASE_URL||''
const email=process.env.ADMIN_E2E_SUPER_EMAIL||''
const password=process.env.ADMIN_E2E_SUPER_PASSWORD||''
type StoredState=Awaited<ReturnType<BrowserContext['storageState']>>
let state:StoredState|undefined

type Observation={consoleErrors:string[];pageErrors:string[];failedRequests:string[];badResponses:string[];reactWarnings:string[]}

function observe(page:Page):Observation{
  const result:Observation={consoleErrors:[],pageErrors:[],failedRequests:[],badResponses:[],reactWarnings:[]}
  page.on('console',message=>{
    const location=message.location().url||''
    if(location.startsWith('chrome-extension://'))return
    if(message.type()==='error')result.consoleErrors.push(`${message.text()} @ ${location||'inline'}`)
    if(message.type()==='warning'&&/react|warning|recharts/i.test(message.text()))result.reactWarnings.push(message.text())
  })
  page.on('pageerror',error=>result.pageErrors.push(error.stack||error.message))
  page.on('requestfailed',request=>result.failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText||'unknown'}`))
  page.on('response',response=>{
    if(response.url().startsWith(baseUrl)&&response.status()>=400)result.badResponses.push(`${response.status()} ${response.request().method()} ${response.url()}`)
  })
  return result
}
function clean(result:Observation){
  expect(result.consoleErrors).toEqual([])
  expect(result.pageErrors).toEqual([])
  expect(result.failedRequests).toEqual([])
  expect(result.badResponses).toEqual([])
  expect(result.reactWarnings).toEqual([])
}
async function openDashboard(page:Page){
  const select=page.locator('.tenant-select')
  const option=select.locator('option').filter({hasText:'ПИВНИК TEST · ПИВНИК TEST VENUE'})
  await expect(option).toHaveCount(1)
  await select.selectOption(await option.getAttribute('value')||'')
  const overview=page.locator('.sidebar').getByRole('button',{name:'Обзор',exact:true})
  if(!await overview.isVisible()){
    await page.locator('.mobile-menu').click()
    await expect(overview).toBeVisible()
  }
  await overview.click()
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
      const dimensions=await page.evaluate(()=>({clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}))
      console.log(`SMALL_RESPONSIVE_PROOF ${label} client=${dimensions.clientWidth} scroll=${dimensions.scrollWidth} overflow=${dimensions.scrollWidth-dimensions.clientWidth}`)
      expect(dimensions.scrollWidth-dimensions.clientWidth).toBeLessThanOrEqual(1)
      clean(failures)
    }finally{await context.close()}
  })
}
