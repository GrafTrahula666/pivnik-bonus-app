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
export function resolvePivnikLegacyStatus(rollingSpendCents:number):LegacyStatusLevel{
  let current=PIVNIK_LEGACY_STATUS_LEVELS[0]!
  for(const l of PIVNIK_LEGACY_STATUS_LEVELS) if(rollingSpendCents>=l.minCents) current=l
  return current
}
