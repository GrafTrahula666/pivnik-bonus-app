// Synthetic browser-only fixture. No database, real authentication or provider calls.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductionCRM } from '../../src/phaseC/ProductionCRM'
import type { AdminSession, ApiVenue } from '../../src/api'
import '../../src/styles.css'
import '../../src/responsive-fixes.css'
const session: AdminSession = {
  admin: { id: 'fixture', email: 'fixture@example.invalid', displayName: 'Fixture', role: 'VENUE_ADMIN' },
  csrfToken: 'synthetic-only', capabilities: { writes: false, productionBonusWrites: false,
    productionAchievementWrites: false, productionEntitlementWrites: false, demo: false },
}
function Fixture() {
  const [scope, setScope] = useState('101')
  const venue: ApiVenue = { id: scope, companyId: scope === '201' ? '20' : '10', companyCode: 'fixture',
    companyName: 'Synthetic company', code: scope, name: 'Synthetic venue', address: null, legacyBarId: null }
  return <main style={{ maxWidth: 1400, margin: 'auto', padding: 16 }}>
    <label>Тестовое заведение <select aria-label="Тестовое заведение" value={scope} onChange={e => setScope(e.target.value)}>
      <option value="101">A1</option><option value="102">A2</option><option value="201">B1</option>
    </select></label>
    <ProductionCRM key={`${venue.companyId}:${venue.id}`} venue={venue} session={session}/>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
