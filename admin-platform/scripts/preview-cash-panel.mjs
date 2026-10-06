// Offline visual preview of the real Business UI. Never contacts a service.
import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const index=await fs.readFile(path.join(root,'dist/index.html'),'utf8')
const asset=(pattern)=>path.join(root,'dist',index.match(pattern)[1].replace(/^\//,''))
const js=await fs.readFile(asset(/src="([^"]+\.js)"/),'utf8')
const css=(await fs.readFile(asset(/href="([^"]+\.css)"/),'utf8')).replace(/@import\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g,'')
const fixture=()=>{
  const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10)
  const values={trackedRevenue:4500,checkCount:15,averageCheck:300,totalCustomers:50,newCustomers:5,activeCustomers:7,returningCustomers:2,bonusEarned:800,bonusRedeemed:100,outstandingBonusBalance:3500,visits:null,redemptionRate:12.5}
  const dashboard={metrics:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,available:value!==null,source:'Вымышленные данные предпросмотра'}])),previousMetrics:{},trend:[],platformSplit:{vk:22,telegram:28,both:0,unknown:0,note:'Вымышленные данные'},unavailableMetrics:[],dataSource:{legacyBarId:null,accountMode:'preview'},
    pos:{connection:{state:'connected',lastSuccessAt:new Date().toISOString()},all:{salesCents:'1075000',returnsCents:'25000',netCents:'1050000',averageCents:'59722',receiptCount:18,saleDocuments:18,returnDocuments:1,days:[{label:today,amountCents:'1050000'}],payments:[{label:'Наличные',amountCents:'350000'},{label:'Карта',amountCents:'700000'}]}}}
  window.fetch=async(input,init={})=>{
    const url=new URL(typeof input==='string'?input:input.url,'https://preview.invalid')
    if(init.method&&!['GET','HEAD'].includes(init.method))return new Response(JSON.stringify({error:'Предпросмотр: изменения отключены'}),{status:403})
    const venue={id:'preview-cash',companyId:'preview',companyCode:'PIVNIK',companyName:'ПИВНИК',code:'PIVNIK',name:'ПИВНИК',address:null,legacyBarId:null}
    let body
    if(url.pathname==='/api/admin/auth/session')body={admin:{id:'preview',email:'preview@example.invalid',displayName:'Пивник · пример',role:'VENUE_ADMIN'},csrfToken:'preview',capabilities:{writes:false,productionBonusWrites:false,productionAchievementWrites:false,productionEntitlementWrites:false,demo:false}}
    else if(url.pathname==='/api/admin/venues')body={venues:[venue]}
    else if(url.pathname==='/api/admin/venues/preview-cash/dashboard')body=dashboard
    else return new Response(JSON.stringify({error:'Этот раздел не включён в предпросмотр кассы'}),{status:403})
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}})
  }
}
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Пивник Business · кассовая панель</title><style>${css}
.preview-banner{position:relative;z-index:1000;background:#302918;color:#ffdf8e;border-bottom:1px solid #655325;padding:8px 12px;text-align:center;font:11px system-ui;line-height:1.4}
.sidebar{top:32px}@media(max-width:860px){.sidebar{top:48px}}
</style></head><body><div class="preview-banner">ПРЕДПРОСМОТР · ВЫМЫШЛЕННЫЕ ДАННЫЕ · Касса и БД не подключены · Переключайте «Программа лояльности / Все продажи кассы»</div><div id="root"></div><script>(${fixture.toString()})();</script><script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`
await fs.writeFile(path.join(root,'preview/evotor-cash.html'),html)
console.log('preview/evotor-cash.html')
