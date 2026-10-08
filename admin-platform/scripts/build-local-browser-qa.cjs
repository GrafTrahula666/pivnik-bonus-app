
const fs=require('fs'), path=require('path')
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js')
const root=process.cwd(), src=path.join(root,'src'), out=path.join(root,'.qa-browser')
fs.mkdirSync(out,{recursive:true})

function walk(dir){
  return fs.readdirSync(dir).flatMap(name=>{
    const full=path.join(dir,name), st=fs.statSync(full)
    return st.isDirectory()?walk(full):/\.(ts|tsx)$/.test(name)&&!full.includes(`${path.sep}tests${path.sep}`)?[full]:[]
  })
}
const files=walk(src)
const modules={}
for(const file of files){
  const id=path.relative(root,file).replace(/\\/g,'/')
  const source=fs.readFileSync(file,'utf8')
  const result=ts.transpileModule(source,{
    fileName:file,
    compilerOptions:{
      target:ts.ScriptTarget.ES2020,
      module:ts.ModuleKind.CommonJS,
      jsx:ts.JsxEmit.React,
      esModuleInterop:true,
      allowSyntheticDefaultImports:true,
    }
  })
  modules[id]=result.outputText
}

let runtime=String.raw`
(function(){
'use strict';
if(!globalThis.crypto.randomUUID){
  globalThis.crypto.randomUUID=()=>{
    const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const h=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  };
}
const __mods=Object.create(null), __cache=Object.create(null), __externals=Object.create(null);

function normalize(parts){
  const out=[]
  for(const p of parts){ if(!p||p==='.')continue; if(p==='..')out.pop(); else out.push(p) }
  return out.join('/')
}
function resolve(from,spec){
  if(!spec.startsWith('.'))return spec
  const base=from.split('/').slice(0,-1)
  const raw=normalize([...base,...spec.split('/')])
  const candidates=[raw,raw+'.ts',raw+'.tsx',raw+'.js',raw+'.jsx',raw+'/index.ts',raw+'/index.tsx']
  for(const c of candidates)if(__mods[c])return c
  if(spec.endsWith('.css'))return '__css__'
  throw new Error('QA module not found: '+spec+' from '+from)
}
function __require(id){
  if(__externals[id])return __externals[id]
  if(id==='__css__')return {}
  if(__cache[id])return __cache[id].exports
  const factory=__mods[id]; if(!factory)throw new Error('Missing module '+id)
  const module={exports:{}}; __cache[id]=module
  factory(module,module.exports,spec=>__require(resolve(id,spec)))
  return module.exports
}

// Minimal React-compatible QA renderer. Product source is unchanged.
const Fragment=Symbol('Fragment')
let ROOT=null, ROOT_NODE=null, current=null, effects=[], scheduled=false
const stateMap=new Map()
function flat(children,out=[]){for(const c of children){if(Array.isArray(c))flat(c,out);else if(c!==null&&c!==undefined&&c!==false&&c!==true)out.push(c)}return out}
function createElement(type,props,...children){
  props=props?{...props}:{}
  const key=props.key??null; delete props.key
  props.children=flat(children)
  return {type,props,key}
}
function depsEqual(a,b){return a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]))}
function hookStore(){if(!current)throw new Error('Hooks outside component'); let s=stateMap.get(current.id);if(!s){s=[];stateMap.set(current.id,s)}return s}
function useState(initial){
  const store=hookStore(), idx=current.hook++
  if(!store[idx])store[idx]={value:typeof initial==='function'?initial():initial}
  const id=current.id
  return [store[idx].value,(next)=>{const s=stateMap.get(id);const prev=s[idx].value;s[idx].value=typeof next==='function'?next(prev):next;schedule()}]
}
function useMemo(factory,deps){
  const store=hookStore(), idx=current.hook++, prev=store[idx]
  if(!prev||!depsEqual(prev.deps,deps)){const value=factory();store[idx]={value,deps};return value}
  return prev.value
}
function useEffect(fn,deps){
  const store=hookStore(), idx=current.hook++, prev=store[idx]
  if(!prev||!depsEqual(prev.deps,deps)){effects.push(()=>{if(prev&&typeof prev.cleanup==='function')try{prev.cleanup()}catch{};const cleanup=fn();store[idx]={deps,cleanup}})}
}
function StrictMode({children}){return children}
const React={createElement,Fragment,useState,useMemo,useEffect,StrictMode}
React.default=React
__externals['react']=React

function setProp(el,name,value,isSvg){
  if(name==='children'||name==='key'||value===undefined||value===null)return
  if(name==='className'){el.setAttribute('class',value);return}
  if(name==='htmlFor'){el.setAttribute('for',value);return}
  if(name==='style'&&typeof value==='object'){for(const [k,v] of Object.entries(value)){if(k.startsWith('--'))el.style.setProperty(k,String(v));else try{el.style[k]=typeof v==='number'&& !['opacity','zIndex','fontWeight'].includes(k)?v+'px':String(v)}catch{}}return}
  if(name==='dangerouslySetInnerHTML'){el.innerHTML=value.__html||'';return}
  if(/^on[A-Z]/.test(name)&&typeof value==='function'){
    let event=name.slice(2).toLowerCase()
    if(event==='change'&&(el.tagName==='INPUT'||el.tagName==='TEXTAREA'))event='input'
    el.addEventListener(event,value);return
  }
  if(name==='checked'){el.checked=Boolean(value);return}
  if(name==='value'){el.value=String(value);return}
  if(name==='disabled'){el.disabled=Boolean(value);return}
  if(name==='selected'){el.selected=Boolean(value);return}
  if(name==='readOnly'){el.readOnly=Boolean(value);return}
  if(name==='tabIndex'){el.tabIndex=Number(value);return}
  if(typeof value==='boolean'){if(value)el.setAttribute(name,'');return}
  try{el.setAttribute(name,String(value))}catch{}
}
function dom(vnode,path='0',svg=false){
  if(vnode===null||vnode===undefined||vnode===false||vnode===true)return document.createComment('')
  if(typeof vnode==='string'||typeof vnode==='number')return document.createTextNode(String(vnode))
  if(Array.isArray(vnode)){const f=document.createDocumentFragment();vnode.forEach((v,i)=>f.appendChild(dom(v,path+'.'+i,svg)));return f}
  if(vnode.type===Fragment){const f=document.createDocumentFragment();(vnode.props.children||[]).forEach((v,i)=>f.appendChild(dom(v,path+'.f'+i,svg)));return f}
  if(typeof vnode.type==='function'){
    const prev=current, id=path+':'+(vnode.type.name||'anon')+':'+(vnode.key??'')
    current={id,hook:0}
    let rendered
    try{rendered=vnode.type({...vnode.props})}finally{current=prev}
    return dom(rendered,path+'.c',svg)
  }
  const tag=vnode.type, isSvg=svg||tag==='svg'
  const el=isSvg?document.createElementNS('http://www.w3.org/2000/svg',tag):document.createElement(tag)
  const props=vnode.props||{}
  for(const [k,v] of Object.entries(props))setProp(el,k,v,isSvg)
  ;(props.children||[]).forEach((child,i)=>el.appendChild(dom(child,path+'.'+(child&&child.key!=null?'k'+child.key:i),isSvg)))
  if(tag==='select'&&props.value!==undefined)el.value=String(props.value)
  return el
}
function render(){
  if(!ROOT_NODE||!ROOT)return
  effects=[]
  const next=dom(ROOT,'0',false)
  ROOT_NODE.replaceChildren(next)
  const run=effects.slice();effects=[]
  queueMicrotask(()=>run.forEach(fn=>{try{fn()}catch(e){console.error(e)}}))
}
function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;render()})}
const ReactDOM={createRoot(node){ROOT_NODE=node;return{render(v){ROOT=v;render()}}}}
__externals['react-dom/client']=ReactDOM

function iconFactory(name){
  return function Icon(props={}){
    const size=props.size||18
    return createElement('svg',{...props,width:size,height:size,viewBox:'0 0 24 24',fill:'none','aria-hidden':'true'},
      createElement('circle',{cx:12,cy:12,r:8,stroke:'currentColor'}),
      createElement('path',{d:'M8 12h8M12 8v8',stroke:'currentColor','stroke-linecap':'round'})
    )
  }
}
const iconNames=__ICON_NAMES__
const icons={}; for(const n of iconNames)icons[n]=iconFactory(n)
__externals['lucide-react']=icons

function chartLine(data,key,color='#b9ff66'){
  const vals=(data||[]).map(x=>Number(x?.[key]??0)).filter(Number.isFinite)
  if(!vals.length)return ''
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||1
  return vals.map((v,i)=>String(i/(Math.max(1,vals.length-1))*100)+','+String(92-(v-min)/range*78)).join(' ')
}
function AreaChart(props){
  const data=props.data||[]
  let key='value', color='#b9ff66'
  const children=flat(props.children||[])
  for(const c of children){if(c&&c.props&&c.props.dataKey){key=c.props.dataKey;color=c.props.stroke||color}}
  return createElement('svg',{viewBox:'0 0 100 100',preserveAspectRatio:'none',style:{width:'100%',height:'100%'}},
    createElement('polyline',{points:chartLine(data,key,color),fill:'none',stroke:color,'stroke-width':'2','vector-effect':'non-scaling-stroke'})
  )
}
function PieChart(props){return createElement('div',{style:{width:'100%',height:'100%',borderRadius:'50%',background:'conic-gradient(#b9ff66 0 64%, #25292e 64% 100%)'}},props.children)}
function ResponsiveContainer(props){return createElement('div',{style:{width:typeof props.width==='number'?props.width+'px':props.width||'100%',height:typeof props.height==='number'?props.height+'px':props.height||'100%'}},props.children)}
const recharts={ResponsiveContainer,AreaChart,PieChart,Area:()=>null,Pie:()=>null,Cell:()=>null,CartesianGrid:()=>null,Tooltip:()=>null,XAxis:()=>null,YAxis:()=>null}
__externals['recharts']=recharts

window.__qaModules=__mods
window.__qaRequire=__require
window.__qaReact=React
`

const qaApi=String.raw`
const QA={session:null,configs:Object.create(null)}
const superAdmin={admin:{id:'1',email:'super@qa.local',displayName:'Platform QA',role:'SUPER_ADMIN'},csrfToken:'qa-csrf',capabilities:{writes:true,productionBonusWrites:false,productionAchievementWrites:false,productionEntitlementWrites:false,demo:true}}
const venueAdmin={admin:{id:'2',email:'venue@qa.local',displayName:'Алексей Морозов',role:'VENUE_ADMIN'},csrfToken:'qa-csrf',capabilities:{writes:true,productionBonusWrites:false,productionAchievementWrites:false,productionEntitlementWrites:false,demo:true}}
const venues=[
 {id:'1',companyId:'1',companyCode:'pivnik',companyName:'ПИВНИК',code:'pivnik-center',name:'ПИВНИК · Центр',address:'Невский проспект, 88',legacyBarId:'1'},
 {id:'3',companyId:'1',companyCode:'pivnik',companyName:'ПИВНИК',code:'pivnik-river',name:'ПИВНИК · Набережная',address:'Петровская наб., 4',legacyBarId:'1'},
 {id:'2',companyId:'2',companyCode:'north-hospitality-test',companyName:'NORTH HOSPITALITY · TEST',code:'north-bar-test',name:'NORTH BAR · TEST',address:'Synthetic QA venue',legacyBarId:null},
]
const clients=Array.from({length:18},(_,i)=>({
 id:String(1001+i),name:['Анна Смирнова','Максим Волков','Екатерина Морозова','Алексей Орлов','Мария Соколова','Илья Попов'][i%6],
 username:['anna','max','katya','alex','maria','ilya'][i%6]+(i||''),registeredAt:new Date(Date.now()-(i+4)*86400000).toISOString(),
 membershipStatus:'active',balance:400+i*137,lifetimeSpend:12500+i*2890,averageCheck:950+(i%5)*240,operationCount:4+i,lastActivityAt:new Date(Date.now()-(i%9)*86400000).toISOString(),
 bonusEarned:1100+i*73,bonusRedeemed:500+i*31,platform:['telegram','vk','both'][i%3],level:['Путник','Странник','Гость таверны','Завсегдатай'][i%4],cashbackPercent:[5,6,7,8][i%4],
 visitCount:null,visitCountReason:'QA: venue_visit telemetry not connected'
}))
const trend=Array.from({length:30},(_,i)=>({day:'2026-08-'+String(i+1).padStart(2,'0'),revenue:62000+i*1800+Math.round(Math.sin(i/3)*9000),checks:42+i%9,customers:31+i%8,bonusEarned:2800+i*90,bonusRedeemed:1500+i*50}))
function metric(value,source='qa synthetic staging'){return{value,available:true,source}}
function dash(id){return{
 metrics:{trackedRevenue:metric(id==='2'?980000:1842000),checkCount:metric(1264),averageCheck:metric(1457),totalCustomers:metric(8490),newCustomers:metric(428),activeCustomers:metric(3120),returningCustomers:metric(2144),bonusEarned:metric(182400),bonusRedeemed:metric(104800),outstandingBonusBalance:metric(1278000),visits:{value:null,available:false,reason:'Нет venue_visit telemetry'},redemptionRate:metric(57.5)},
 previousMetrics:{trackedRevenue:1684000,checkCount:1180,averageCheck:1427,totalCustomers:8120,newCustomers:390,transactionActiveCustomers:2970,returningCustomers:2010,bonusEarned:171000,bonusRedeemed:98000,outstandingBonusBalance:1210000,redemptionRate:57.3},
 trend,platformSplit:{vk:3180,telegram:4010,both:1300,unknown:0,note:'QA synthetic identities'},
 unavailableMetrics:[{key:'DAU',reason:'Нет app_open telemetry в production schema',requiredEvent:'app_open'},{key:'Visits',reason:'Transactions нельзя считать визитами',requiredEvent:'venue_visit'},{key:'Retention',reason:'Нужна activity history',requiredEvent:'app_open / venue_visit'}],
 dataSource:{legacyBarId:id==='2'?null:'1',accountMode:'qa-staging'}
}}
const operations=Array.from({length:32},(_,i)=>({id:String(i+1),occurred_at:new Date(Date.now()-i*3600000*5).toISOString(),first_name:clients[i%clients.length].name.split(' ')[0],last_name:clients[i%clients.length].name.split(' ')[1],user_id:clients[i%clients.length].id,mode:i%4===0?'redeem':'accrue',status:'completed',checkAmount:900+(i%6)*450,cashPaid:800+(i%6)*420,bonusEarned:i%4===0?0:45+(i%6)*20,bonusSpent:i%4===0?120:0,reason:i%7===0?'Welcome campaign':null,reward_code:null,is_suspicious:false}))
const loyalty={source:'db',editable:true,baseCashbackPercent:5,registrationBonus:100,referralBonus:250,levels:[
 {code:'bronze',title:'Путник',thresholdRub:0,bonusPercent:5,discountPercent:0,enabled:true,sortOrder:0},
 {code:'silver',title:'Странник',thresholdRub:10000,bonusPercent:6,discountPercent:0,enabled:true,sortOrder:1},
 {code:'gold',title:'Завсегдатай',thresholdRub:70000,bonusPercent:8,discountPercent:0,enabled:true,sortOrder:2},
 {code:'vip',title:'Король Пивника',thresholdRub:500000,bonusPercent:20,discountPercent:10,enabled:true,sortOrder:3},
]}
const wheel={source:'db',enabled:true,cooldownMinutes:1440,retryCost:100,version:4,prizes:[
 {code:'bonus-100',title:'100 бонусов',rewardType:'bonus',rewardValue:{amount:100},probability:'34',inventoryLimit:null,enabled:true,sortOrder:0},
 {code:'bonus-300',title:'300 бонусов',rewardType:'bonus',rewardValue:{amount:300},probability:'20',inventoryLimit:null,enabled:true,sortOrder:1},
 {code:'coffee',title:'Кофе в подарок',rewardType:'item',rewardValue:{code:'coffee'},probability:'15',inventoryLimit:84,enabled:true,sortOrder:2},
 {code:'retry',title:'Повторный шанс',rewardType:'retry',rewardValue:{count:1},probability:'20',inventoryLimit:null,enabled:true,sortOrder:3},
 {code:'bonus-1000',title:'1000 бонусов',rewardType:'bonus',rewardValue:{amount:1000},probability:'7',inventoryLimit:24,enabled:true,sortOrder:4},
 {code:'secret',title:'Секретный приз',rewardType:'item',rewardValue:{code:'secret'},probability:'4',inventoryLimit:9,enabled:true,sortOrder:5},
]}
const achievements={source:'db',items:[
 {id:'1',code:'first-round',title:'Первый раунд',description:'Сделать первую покупку',condition_type:'purchase_count',threshold_value:1,reward_value:{bonus:100},visibility:'public',enabled:true,sort_order:0},
 {id:'2',code:'regular',title:'Завсегдатай',description:'10 покупок',condition_type:'purchase_count',threshold_value:10,reward_value:{bonus:500},visibility:'public',enabled:true,sort_order:1},
 {id:'3',code:'legend',title:'Легенда бара',description:'Высокий lifetime spend',condition_type:'lifetime_spend',threshold_value:500000,reward_value:{frame:'vip'},visibility:'hidden',enabled:true,sort_order:2},
]}
const shop={source:'db',items:[
 {id:'1',code:'glass',title:'Фирменный бокал',description:'Коллекционный бокал с логотипом.',category:'merch',reward_type:'item',reward_value:{code:'glass'},bonus_price:1600,stock:34,purchase_limit:1,enabled:true,sort_order:0},
 {id:'2',code:'coffee',title:'Кофе за бонусы',description:'Классический кофе до 350 мл.',category:'drink',reward_type:'item',reward_value:{code:'coffee'},bonus_price:650,stock:120,purchase_limit:3,enabled:true,sort_order:1},
 {id:'3',code:'vip-frame',title:'VIP frame',description:'Digital reward.',category:'digital',reward_type:'frame',reward_value:{code:'vip'},bonus_price:3200,stock:null,purchase_limit:1,enabled:true,sort_order:2},
]}
const promotions={source:'db',items:[
 {id:'1',code:'double-wed',title:'Двойной cashback по средам',description:'Усиленная механика на середину недели.',starts_at:'2026-08-01T00:00:00Z',ends_at:'2026-09-30T23:59:00Z',mechanic:{type:'cashback'},reward:{},multiplier:2,enabled:true,sort_order:0,state:'ACTIVE'},
 {id:'2',code:'welcome',title:'Welcome Week',description:'Бонус новым гостям.',starts_at:'2026-09-01T00:00:00Z',ends_at:'2026-09-07T23:59:00Z',mechanic:{type:'registration'},reward:{bonus:500},multiplier:null,enabled:true,sort_order:1,state:'SCHEDULED'},
]}
const branding={source:'legacy-fallback',brandingEnabled:false,branding:{primaryAccent:'#B9FF66',secondaryAccent:'#22262B',theme:'dark',logo:'',cover:''},phone:'+7 999 142-88-02',links:{},venue:{name:'ПИВНИК · Центр',address:'Невский проспект, 88'}}
const flags={wheelEnabled:null,shopEnabled:null,achievementsEnabled:null,referralsEnabled:null,promotionsEnabled:null,brandingEnabled:null,fallback:'null means existing production behavior'}
const auditRows=Array.from({length:12},(_,i)=>({id:String(i+1),created_at:new Date(Date.now()-i*7200000).toISOString(),admin_name:i%2?'Алексей Морозов':'Platform QA',admin_email:'qa@local',admin_role:i%2?'VENUE_ADMIN':'SUPER_ADMIN',company_name:'ПИВНИК',venue_name:'ПИВНИК · Центр',action:['loyalty.config.save','wheel.config.save','customer.cashback.override'][i%3],entity_type:'config',entity_id:String(i+1),reason:'QA synthetic staging action',before_value:{version:i},after_value:{version:i+1}}))
function detail(id){const c=clients.find(x=>x.id===id)||clients[0];return{...c,maxCheck:4200,firstActivityAt:new Date(Date.now()-120*86400000).toISOString(),paidMlTotal:12000,giftMlBalance:500,identities:[{provider:'telegram',provider_user_id:'tg-'+id,provider_username:c.username},{provider:'vk',provider_user_id:'vk-'+id,provider_username:c.username}],timeline:operations.slice(0,8).map(o=>({...o,checkAmount:o.checkAmount,cashPaid:o.cashPaid,bonusEarned:o.bonusEarned,bonusSpent:o.bonusSpent})),achievements:achievements.items,wheelHistory:[],shopPurchases:[]}}
function response(status,data){return Promise.resolve(new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}))}
window.fetch=function(input,init={}){
 const raw=typeof input==='string'?input:input.url, url=new URL(raw,'http://qa.local'), p=url.pathname, method=String(init.method||'GET').toUpperCase()
 if(p==='/api/admin/auth/session')return QA.session?response(200,QA.session):response(401,{code:'AUTH_REQUIRED',error:'Требуется вход в Admin Platform.'})
 if(p==='/api/admin/auth/login'&&method==='POST'){
   const body=JSON.parse(init.body||'{}'); QA.session=String(body.email).startsWith('venue')?venueAdmin:superAdmin; return response(200,QA.session)
 }
 if(p==='/api/admin/auth/logout'){QA.session=null;return response(200,{ok:true})}
 if(!QA.session)return response(401,{code:'AUTH_REQUIRED',error:'Требуется вход.'})
 const allowed=QA.session.admin.role==='SUPER_ADMIN'?venues:venues.filter(v=>v.companyId==='1')
 if(p==='/api/admin/venues')return response(200,{venues:allowed})
 if(p==='/api/admin/platform')return response(200,{companies:venues.map(v=>({company_id:v.companyId,company_code:v.companyCode,company_name:v.companyName,venue_id:v.id,venue_code:v.code,venue_name:v.name,legacy_bar_id:v.legacyBarId,customers:v.companyId==='1'?'8490':'420'})),metrics:{}})
 if(p==='/api/admin/audit')return response(200,{rows:auditRows})
 const m=p.match(/^\/api\/admin\/venues\/([^/]+)\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/)
 if(m){
   const vid=m[1], resource=m[2], child=m[3], grand=m[4]
   if(!allowed.some(v=>v.id===vid))return response(404,{code:'VENUE_NOT_FOUND',error:'Заведение не найдено или недоступно.'})
   if(resource==='dashboard')return response(200,dash(vid))
   if(resource==='clients'&&child)return response(200,detail(child))
   if(resource==='clients'){
     const q=(url.searchParams.get('q')||'').toLowerCase(); const rows=clients.filter(c=>!q||c.name.toLowerCase().includes(q)||(c.username||'').includes(q)||c.id.includes(q)); return response(200,{total:rows.length,rows})
   }
   if(resource==='operations')return response(200,{rows:operations})
   if(resource==='audit')return response(200,{rows:auditRows.filter(x=>vid==='1'||true)})
   if(resource==='capabilities')return response(200,{productionSchema:{users:true,wallets:true,transactions:true,user_identities:true,wheel_spins:true,shop_purchases:true,user_achievements_v2:true},writeOperations:{configWritesEnabled:true,productionBonusWritesEnabled:false,productionAchievementWritesEnabled:false,customerRuntimeDependsOnAdmin:false}})
   if(resource==='loyalty'&&child==='manage'){if(method==='PUT')Object.assign(loyalty,JSON.parse(init.body||'{}'),{source:'db'});return response(200,loyalty)}
   if(resource==='wheel'&&child==='manage'){if(method==='PUT')Object.assign(wheel,JSON.parse(init.body||'{}'),{source:'db'});return response(200,wheel)}
   if(resource==='achievements'&&child==='manage'){if(method==='PUT')Object.assign(achievements,JSON.parse(init.body||'{}'),{source:'db'});return response(200,achievements)}
   if(resource==='shop'&&child==='manage'){if(method==='PUT')Object.assign(shop,JSON.parse(init.body||'{}'),{source:'db'});return response(200,shop)}
   if(resource==='promotions'&&child==='manage'){if(method==='PUT')Object.assign(promotions,JSON.parse(init.body||'{}'),{source:'db'});return response(200,promotions)}
   if(resource==='branding'&&child==='manage'){if(method==='PUT')Object.assign(branding,JSON.parse(init.body||'{}'),{source:'db'});return response(200,branding)}
   if(resource==='features'&&child==='manage'){if(method==='PUT')Object.assign(flags,JSON.parse(init.body||'{}'));return response(200,flags)}
   if(resource==='clients'&&grand==='cashback'&&method==='PUT')return response(200,{ok:true})
   if(resource==='clients'&&grand==='entitlements'&&method==='POST')return response(200,{ok:true,runtimeActive:false})
   if(resource==='wheel')return response(200,{summary:{spins:4821,claims:3944,retrySpend:94350},distribution:[]})
   if(resource==='shop')return response(200,{items:shop.items,purchases:638,bonusSpend:1240000})
   if(resource==='achievements')return response(200,{items:achievements.items,unlockCount:1288})
   if(resource==='promotions')return response(200,{items:promotions.items})
   if(resource==='design')return response(200,{})
 }
 return response(404,{code:'QA_ROUTE_NOT_FOUND',error:'QA route not implemented: '+method+' '+p})
}
`

for(const [id,code] of Object.entries(modules)){
  // Wrap transpiled CommonJS.
  runtime += `\n__mods[${JSON.stringify(id)}]=function(module,exports,require){\n${code}\n};\n`
}
const icons=[...new Set(files.flatMap(file=>{
  const txt=fs.readFileSync(file,'utf8'), found=[]
  const re=/import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"]/gs
  let m; while((m=re.exec(txt)))for(const part of m[1].split(',')){const n=part.trim().replace(/^type\s+/,'').split(/\s+as\s+/)[0];if(n)found.push(n)}
  return found
}))]
runtime=runtime.replace('__ICON_NAMES__',JSON.stringify(icons))
runtime += '\n'+qaApi+'\n__qaRequire("src/main.tsx");\n})();\n'
fs.writeFileSync(path.join(out,'app.js'),runtime)

let css=fs.readFileSync(path.join(src,'styles.css'),'utf8')
css=css.replace(/^@import[^\n]*\n/,'')
css += `\nbody::before{content:"LOCAL QA · SYNTHETIC STAGING DATA · NO PRODUCTION CONNECTION";position:fixed;z-index:9999;right:10px;bottom:10px;padding:7px 10px;border:1px solid #6b5324;border-radius:7px;background:#21190d;color:#e7c36c;font:700 8px/1.2 ui-sans-serif,system-ui;letter-spacing:.08em;pointer-events:none}\n`
fs.writeFileSync(path.join(out,'styles.css'),css)

fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CODEX Admin · Local QA</title><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`)
console.log(`QA browser build: modules=${Object.keys(modules).length}, icons=${icons.length}`)
