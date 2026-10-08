// Isolated browser fixture; no credentials, database or external API calls.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ProductionDashboard } from '../../src/phaseC/ProductionDashboard'
import type { ApiVenue } from '../../src/api'
import '../../src/styles.css'
import '../../src/responsive-fixes.css'
const venue:ApiVenue={id:'a',companyId:'company-a',companyCode:'a',companyName:'Company A',code:'a',name:'Venue A',address:null,legacyBarId:null}
export function Fixture(){const [other,setOther]=useState(false)
 return <main style={{maxWidth:1400,margin:'auto',padding:16}}><button onClick={()=>setOther(v=>!v)}>Сменить заведение</button>
 <ProductionDashboard venue={other?{...venue,id:'b',name:'Venue B'}:venue} period="30 дней" compare={false} onNavigate={()=>{}}/></main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
