import { afterEach,describe,expect,it } from 'vitest'
import { config } from '../config.js'
import { sessionCapabilities } from '../router.js'

describe('session capabilities',()=>{
  const saved={...config}
  afterEach(()=>Object.assign(config,saved))

  it('does not offer production writers while the global write switch is off',()=>{
    Object.assign(config,{enableWrites:false,enableProductionBonusWrites:true,enableProductionAchievementWrites:true,enableProductionEntitlementWrites:true})
    expect(sessionCapabilities()).toMatchObject({writes:false,productionBonusWrites:false,productionAchievementWrites:false,productionEntitlementWrites:false})
  })

  it('offers each production writer only when both switches are on',()=>{
    Object.assign(config,{enableWrites:true,enableProductionBonusWrites:true,enableProductionAchievementWrites:false,enableProductionEntitlementWrites:false})
    expect(sessionCapabilities()).toMatchObject({writes:true,productionBonusWrites:true,productionAchievementWrites:false,productionEntitlementWrites:false})
  })
})
