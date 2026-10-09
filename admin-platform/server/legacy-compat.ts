export interface LegacyStatusLevel { minCents:number; name:string; bonusPercent:number; discountPercent:number; nextCents:number|null }
export const PIVNIK_LEGACY_STATUS_LEVELS:readonly LegacyStatusLevel[]=Object.freeze([
  {minCents:0,name:'Путник',bonusPercent:5,discountPercent:0,nextCents:1_000_000},
  {minCents:1_000_000,name:'Странник',bonusPercent:6,discountPercent:0,nextCents:3_000_000},
  {minCents:3_000_000,name:'Гость таверны',bonusPercent:7,discountPercent:0,nextCents:7_000_000},
  {minCents:7_000_000,name:'Завсегдатай',bonusPercent:8,discountPercent:0,nextCents:10_000_000},
  {minCents:10_000_000,name:'Местный пьяница',bonusPercent:9,discountPercent:0,nextCents:15_000_000},
  {minCents:15_000_000,name:'Легендарный пьяница',bonusPercent:10,discountPercent:0,nextCents:50_000_000},
  {minCents:50_000_000,name:'Король Пивника',bonusPercent:20,discountPercent:10,nextCents:null},
])
export function resolvePivnikLegacyStatus(rollingSpendCents:number,levels:readonly LegacyStatusLevel[]=PIVNIK_LEGACY_STATUS_LEVELS):LegacyStatusLevel{
  let current=levels[0]!
  for(const l of levels) if(rollingSpendCents>=l.minCents) current=l
  return current
}

// The owner can change the levels from Business; the app keeps them in business_runtime_config.
export function parseStoredLevels(value:unknown):readonly LegacyStatusLevel[]|null{
  const raw=(value&&typeof value==='object'?(value as {levels?:unknown}).levels:null)
  if(!Array.isArray(raw)||!raw.length) return null
  const levels=raw.map(x=>x as Record<string,unknown>).map(x=>({minCents:Number(x.minCents),name:String(x.name||''),bonusPercent:Number(x.bonusPercent),discountPercent:Number(x.discountPercent||0),nextCents:null as number|null}))
  if(levels.some(l=>!l.name||!Number.isFinite(l.minCents)||!Number.isFinite(l.bonusPercent))||levels[0]!.minCents!==0) return null
  for(let i=1;i<levels.length;i++){if(levels[i]!.minCents<=levels[i-1]!.minCents) return null;levels[i-1]!.nextCents=levels[i]!.minCents}
  return Object.freeze(levels)
}
let cached:{at:number;levels:readonly LegacyStatusLevel[]}|null=null
export async function loadPivnikStatusLevels(db:{query:(sql:string,params?:unknown[])=>Promise<{rows:Array<{value:unknown}>}>}):Promise<readonly LegacyStatusLevel[]>{
  if(cached&&Date.now()-cached.at<30_000) return cached.levels
  let levels:readonly LegacyStatusLevel[]=PIVNIK_LEGACY_STATUS_LEVELS
  try{
    const r=await db.query(`SELECT value FROM business_runtime_config WHERE key='loyalty'`)
    levels=parseStoredLevels(r.rows[0]?.value)||PIVNIK_LEGACY_STATUS_LEVELS
  }catch{ /* no settings table yet: the app runs on its defaults */ }
  cached={at:Date.now(),levels}
  return levels
}
export function resetPivnikStatusLevelsCache():void { cached=null }
