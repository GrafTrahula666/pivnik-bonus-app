
const fs=require('fs'),path=require('path'),assert=require('assert/strict')
const {pathToFileURL}=require('url')
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js')
const out=path.resolve('.offline-phase-c')
fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true})
function transpile(rel){
 const source=fs.readFileSync(rel,'utf8')
 const result=ts.transpileModule(source,{fileName:rel,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}})
 fs.writeFileSync(path.join(out,path.basename(rel).replace(/\.ts$/,'.js')),result.outputText)
}
for(const f of ['server/types.ts','server/config.ts','server/security.ts','server/tenant.ts','server/legacy-compat.ts','server/audit.ts','server/writes.ts'])transpile(f)
fs.writeFileSync(path.join(out,'db.js'),`
export const pool={query(){throw new Error('offline DB call forbidden')},connect(){throw new Error('offline DB call forbidden')}}
export const readPool=pool
export const writePool=null
`)
function pass(name){console.log('PASS '+name)}
;(async()=>{
 process.env.ADMIN_DATABASE_URL='offline://metadata'
 process.env.ADMIN_ENABLE_WRITES='true'
 const security=await import(pathToFileURL(path.join(out,'security.js')).href)
 const tenant=await import(pathToFileURL(path.join(out,'tenant.js')).href)
 const writes=await import(pathToFileURL(path.join(out,'writes.js')).href)

 const password='Correct Horse Battery 2026!'
 const hash=security.hashPassword(password)
 assert.ok(hash.startsWith('scrypt$'));assert.ok(!hash.includes(password));assert.equal(security.verifyPassword(password,hash),true)
 pass('scrypt authentication primitives')

 const venueAdmin={id:'11',email:'a@test',displayName:'A',role:'VENUE_ADMIN'}
 const statement=tenant.buildVenueScopeQuery(venueAdmin,'101')
 assert.deepEqual(statement.params,['101','11']);assert.match(statement.text,/admin_company_access/);assert.match(statement.text,/aca\.company_id = v\.company_id/)
 for(const forged of ['../2','1 OR 1=1','0','-1','1?company_id=9'])assert.throws(()=>tenant.parsePositiveId(forged,'venue_id'))
 pass('tenant URL/body-independent authorization query')

 const validBonus={type:'credit',amount:100,reason:'Service recovery',idempotencyKey:'bonus:test:123456'}
 assert.equal(writes.validateBonusAdjustmentInput(validBonus,'7').amount,100)
 for(const amount of [0,-1,NaN,Infinity,1.5,1000001])assert.throws(()=>writes.validateBonusAdjustmentInput({...validBonus,amount},'7'))
 assert.throws(()=>writes.validateBonusAdjustmentInput(validBonus,'7 OR 1=1'))
 pass('bonus amount/user/idempotency validation')

 assert.equal(writes.percentToPpb('0.0000001'),1n)
 assert.equal(writes.ppbToPercent(1n),'0.0000001')
 writes.validateWheel({enabled:true,cooldownMinutes:1440,retryCost:0,prizes:[
  {code:'rare',title:'Rare',rewardType:'item',rewardValue:{code:'rare'},probability:'0.0000001',inventoryLimit:1,enabled:true,sortOrder:0},
  {code:'rest',title:'Rest',rewardType:'none',rewardValue:{},probability:'99.9999999',inventoryLimit:null,enabled:true,sortOrder:1},
 ]})
 assert.throws(()=>writes.validateWheel({enabled:true,cooldownMinutes:1,retryCost:0,prizes:[
  {code:'bad',title:'Bad',rewardType:'none',rewardValue:{},probability:'99.9',inventoryLimit:null,enabled:true,sortOrder:0},
 ]}))
 pass('decimal-safe wheel probability = exactly 100%')

 writes.validateLoyalty({baseCashbackPercent:5,registrationBonus:100,referralBonus:0,levels:[
  {code:'a',title:'A',thresholdRub:0,bonusPercent:5,enabled:true,sortOrder:0},
  {code:'b',title:'B',thresholdRub:10000,bonusPercent:7,enabled:true,sortOrder:1},
 ]})
 assert.throws(()=>writes.validateLoyalty({baseCashbackPercent:5,registrationBonus:100,referralBonus:0,levels:[
  {code:'a',title:'A',thresholdRub:100,bonusPercent:5,enabled:true,sortOrder:0},
  {code:'b',title:'B',thresholdRub:100,bonusPercent:7,enabled:true,sortOrder:1},
 ]}))
 pass('loyalty threshold invariants')

 const now=new Date('2026-08-29T10:00:00Z')
 assert.equal(writes.promotionState({enabled:false},now),'DISABLED')
 assert.equal(writes.promotionState({enabled:true,starts_at:'2026-08-30T00:00:00Z'},now),'SCHEDULED')
 assert.equal(writes.promotionState({enabled:true,starts_at:'2026-08-28T00:00:00Z',ends_at:'2026-08-30T00:00:00Z'},now),'ACTIVE')
 assert.equal(writes.promotionState({enabled:true,ends_at:'2026-08-29T09:00:00Z'},now),'FINISHED')
 pass('server-side promotion state')

 const demo=fs.readFileSync('src/phaseC/DemoMode.tsx','utf8')
 assert.ok(!demo.includes('apiPost(')&&!demo.includes('apiPut(')&&!demo.includes('/api/admin/'))
 pass('Demo Mode cannot perform production API writes')

 const migrations=fs.readdirSync('admin-migrations').map(n=>fs.readFileSync(path.join('admin-migrations',n),'utf8')).join('\n')
 assert.doesNotMatch(migrations,/\bDROP\s+(?:TABLE|COLUMN)\b/i)
 assert.doesNotMatch(migrations,/\bTRUNCATE\b/i)
 assert.doesNotMatch(migrations,/\bALTER\s+TABLE\s+(?:users|wallets|transactions|bars|bar_customers|user_identities)\b/i)
 pass('additive-only migration policy')

 console.log('offline-phase-c-check: 8/8 passed')
})().catch(e=>{console.error(e);process.exitCode=1})
