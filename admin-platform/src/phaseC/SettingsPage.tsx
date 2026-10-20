import type { AdminSession,ApiVenue } from '../api'
import { FeatureFlagsManager } from './ProductionManagers'
import { AccountSecurityPanel } from './AccountSecurity'
import { BusinessSettingsOverview } from './BusinessSettingsOverview'

export function SettingsPage({venue,session}:{venue:ApiVenue;session:AdminSession}){
  return <>
    {session.capabilities.writes
      ? <FeatureFlagsManager venue={venue} session={session}/>
      : <BusinessSettingsOverview venue={venue} session={session}/>}
    <AccountSecurityPanel session={session}/>
  </>
}
