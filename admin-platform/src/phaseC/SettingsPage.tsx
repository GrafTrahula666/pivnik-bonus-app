import type { AdminSession,ApiVenue } from '../api'
import { FeatureFlagsManager } from './ProductionManagers'
import { AccountSecurityPanel } from './AccountSecurity'

export function SettingsPage({venue,session}:{venue:ApiVenue;session:AdminSession}){
  return <>
    <FeatureFlagsManager venue={venue} session={session}/>
    <AccountSecurityPanel session={session}/>
  </>
}
