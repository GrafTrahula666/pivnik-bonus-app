import {expect,test} from '@playwright/test'

const baseUrl=process.env.ADMIN_E2E_BASE_URL||''
const email=process.env.ADMIN_E2E_SUPER_EMAIL||'super-admin@pivnik.test'
const password=process.env.ADMIN_E2E_SUPER_PASSWORD||''

test('diagnose 1366 horizontal overflow on venue dashboard',async({page})=>{
  test.skip(!baseUrl||!password,'Set staging URL and SUPER staging password')
  await page.setViewportSize({width:1366,height:768})
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'})
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button',{name:'Войти'}).click()
  await expect(page.locator('.app-shell')).toBeVisible()

  const select=page.locator('.tenant-select')
  const option=select.locator('option').filter({hasText:'ПИВНИК TEST · ПИВНИК TEST VENUE'})
  await expect(option).toHaveCount(1)
  await select.selectOption(await option.getAttribute('value')||'')
  await page.locator('.sidebar').getByRole('button',{name:'Обзор',exact:true}).click()
  await expect(page.getByRole('heading',{name:'ПИВНИК TEST VENUE',exact:true}).first()).toBeVisible()
  await expect(page.locator('.kpi-grid')).toBeVisible()

  const diag=await page.evaluate(()=>{
    const root=document.documentElement
    const clientWidth=root.clientWidth
    const scrollWidth=root.scrollWidth
    const offenders=[...document.querySelectorAll<HTMLElement>('*')].map((el,index)=>{
      const r=el.getBoundingClientRect()
      const cs=getComputedStyle(el)
      return {
        index,
        tag:el.tagName,
        id:el.id,
        className:typeof el.className==='string'?el.className:'',
        left:Number(r.left.toFixed(2)),
        right:Number(r.right.toFixed(2)),
        width:Number(r.width.toFixed(2)),
        scrollWidth:el.scrollWidth,
        clientWidth:el.clientWidth,
        display:cs.display,
        position:cs.position,
        minWidth:cs.minWidth,
        widthCss:cs.width,
        overflowX:cs.overflowX,
        text:(el.textContent||'').trim().replace(/\s+/g,' ').slice(0,120),
      }
    }).filter(x=>x.right>clientWidth+1||x.left<-1||x.scrollWidth>x.clientWidth+1)
      .sort((a,b)=>Math.max(b.right-clientWidth,b.scrollWidth-b.clientWidth)-Math.max(a.right-clientWidth,a.scrollWidth-a.clientWidth))
      .slice(0,50)
    return {clientWidth,scrollWidth,diff:scrollWidth-clientWidth,offenders}
  })
  console.log('OVERFLOW_DIAG '+JSON.stringify(diag))
  expect(diag.diff).toBeLessThanOrEqual(1)
})
