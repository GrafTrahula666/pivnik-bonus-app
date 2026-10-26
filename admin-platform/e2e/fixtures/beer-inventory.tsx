import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {BeerInventory} from '../../src/phaseC/BeerInventory'
import type {ApiVenue} from '../../src/api'
import '../../src/styles.css'
import '../../src/responsive-fixes.css'
import '../../src/spaceverse.css'
const venue:ApiVenue={id:'101',companyId:'10',companyCode:'fixture',companyName:'Fixture',code:'fixture',name:'Synthetic venue',address:null,legacyBarId:null}
export function Fixture(){const [other,setOther]=useState(false);const id=other?'202':'101';return <main style={{padding:16}}><button onClick={()=>setOther(v=>!v)}>Сменить заведение</button><BeerInventory key={id} venue={{...venue,id}} actorId="fixture-owner"/></main>}
createRoot(document.getElementById('root')!).render(<Fixture/>)
