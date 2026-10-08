import type { VenueScope } from './types.js'
import { getManagedAchievements, getManagedWheel } from './writes.js'
import {
  legacyAchievementCondition,
  PIVNIK_LEGACY_ACHIEVEMENTS,
  PIVNIK_LEGACY_WHEEL_PRIZES,
  PIVNIK_RUNTIME_COMMIT,
  PIVNIK_WHEEL_COOLDOWN_MINUTES,
} from './pivnik-legacy-catalog.js'

function isExactPivnik(scope:VenueScope):boolean{
  return scope.companyCode==='pivnik' && String(scope.legacyBarId||'')==='1'
}

export async function getPivnikManagedWheelRead(scope:VenueScope){
  const managed=await getManagedWheel(scope)
  if(managed.source!=='unconfigured' || !isExactPivnik(scope))return managed
  return {
    source:'legacy-production-runtime',
    editable:false,
    runtimeCommit:PIVNIK_RUNTIME_COMMIT,
    enabled:true,
    cooldownMinutes:PIVNIK_WHEEL_COOLDOWN_MINUTES,
    retryCost:50,
    retryCostPolicy:{firstPaid:50,subsequentPaid:100},
    version:0,
    prizes:PIVNIK_LEGACY_WHEEL_PRIZES.map((prize)=>({...prize})),
  }
}

export async function getPivnikManagedAchievementsRead(scope:VenueScope){
  const managed=await getManagedAchievements(scope)
  if(managed.source!=='unconfigured' || !isExactPivnik(scope))return managed
  return {
    source:'legacy-production-runtime',
    editable:false,
    runtimeCommit:PIVNIK_RUNTIME_COMMIT,
    items:PIVNIK_LEGACY_ACHIEVEMENTS.map((definition,index)=>{
      const condition=legacyAchievementCondition(definition)
      return {
        code:definition.code,
        title:definition.title,
        description:definition.description,
        imageSrc:null,
        conditionType:condition.conditionType,
        thresholdValue:condition.thresholdValue,
        rewardValue:{bonus:definition.rewardBonus,beerMl:definition.rewardBeerMl},
        visibility:'public',
        enabled:true,
        sortOrder:index,
        legacyCode:definition.code,
        legacyMetric:definition.metric,
        legacyTarget:definition.target,
        legacyUnit:definition.unit,
        rarity:definition.rarity,
        recurring:definition.recurring,
        special:definition.special,
      }
    }),
  }
}
