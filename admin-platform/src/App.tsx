import { useCallback,useEffect,useState } from 'react'
import { AlertTriangle,Database,RefreshCw,ShieldCheck } from 'lucide-react'
import type { Page } from './appTypes'
import { ApiError,apiGet,getSession,isAuthError,logout,type AdminSession,type ApiVenue } from './api'
import { Login } from './Login'
import { PhaseCSidebar,PhaseCTopbar,TenantDangerContext,type AppMode,type Period } from './phaseC/Layout'
import { ProductionDashboard } from './phaseC/ProductionDashboard'
import { ProductionCRM } from './phaseC/ProductionCRM'
import {
  CompanyVenuesOverview,ProductionAnalytics,ProductionAudit,ProductionOperations,ProductionPlatform,
} from './phaseC/ProductionReadPages'
import {
  BrandingManager,LoyaltyManager,PromotionManager,ShopManager,
} from './phaseC/ProductionManagers'
import { AppDesignManager,AppPromotionsManager,isPivnikAppVenue } from './phaseC/AppContentManagers'
import { PivnikLegacyAchievementManager,PivnikLegacyWheelManager } from './phaseC/PivnikLegacyManagers'
import { AppAchievementsManager } from './phaseC/AppRewardsManagers'
import { AppLoyaltyManager } from './phaseC/AppLoyaltyManager'
import { AppWheelManager } from './phaseC/AppWheelManager'
import { SettingsPage } from './phaseC/SettingsPage'
import { BeerIntake } from './phaseC/BeerIntake'
import { BeerInventory } from './phaseC/BeerInventory'
import { AccountSecurityPanel } from './phaseC/AccountSecurity'
import { BroadcastPage } from './phaseC/BroadcastPage'
import {OnboardingSupportQueue} from './phaseC/OnboardingSupportQueue'
import { DeveloperPage } from './phaseC/DeveloperPage'
import { DemoMode } from './phaseC/DemoMode'
import { VenueOnboarding } from './phaseC/VenueOnboarding'
import { OnboardingInvitations } from './phaseC/OnboardingInvitations'
import {OwnerVenues} from './phaseC/OwnerVenues'
import { InviteAcceptance } from './phaseC/InviteAcceptance'

type AuthState='loading'|'guest'|'authenticated'|'error'

// The public demo: sample data only, no API calls, nothing is saved.
const DEMO_SESSION:AdminSession={
  admin:{id:'demo',email:'',displayName:'Демо-гость',role:'SUPER_ADMIN'},csrfToken:'',
  capabilities:{writes:false,productionBonusWrites:false,productionAchievementWrites:false,productionEntitlementWrites:false,demo:true},
}

export default function App(){
  const [authState,setAuthState]=useState<AuthState>('loading')
  const [authError,setAuthError]=useState('')
  const [session,setSession]=useState<AdminSession|null>(null)
  const [venues,setVenues]=useState<ApiVenue[]>([])
  const [venueError,setVenueError]=useState('')
  const [venueId,setVenueId]=useState('')
  const [page,setPage]=useState<Page>('overview')
  const [period,setPeriod]=useState<Period>('30 дней')
  const [compare,setCompare]=useState(true)
  const [mobileNav,setMobileNav]=useState(false)
  const [mode,setMode]=useState<AppMode>('production')
  const [retry,setRetry]=useState(0)
  const [broadcastSegment,setBroadcastSegment]=useState('')
  const [demoAvailable,setDemoAvailable]=useState(false),[demoGuest,setDemoGuest]=useState(false)
  const [invitationAvailable,setInvitationAvailable]=useState(false)
  const [inviteToken,setInviteToken]=useState<string|null>(()=>new URLSearchParams(window.location.hash.slice(1)).get('invite'))
  const [onboardingDraftId,setOnboardingDraftId]=useState<string|null>(null)
  const [onboardingOpenRequest,setOnboardingOpenRequest]=useState(0),[ownerListRevision,setOwnerListRevision]=useState(0)
  const refreshOwnerList=useCallback(()=>setOwnerListRevision(value=>value+1),[])

  useEffect(()=>{let cancelled=false;setAuthState('loading');setAuthError('')
    getSession().then(s=>{if(cancelled)return;setSession(s);setAuthState('authenticated');setPage(s.admin.role==='SUPER_ADMIN'?'platform':'overview')})
      .catch(e=>{if(cancelled)return;if(isAuthError(e)){const detail=(e as ApiError).details as {demo?:boolean;invitations?:boolean}|undefined;setDemoAvailable(Boolean(detail?.demo));setInvitationAvailable(Boolean(detail?.invitations));setAuthState('guest');setSession(null)}else{setAuthError(e instanceof Error?e.message:'Сервис управления недоступен.');setAuthState('error')}})
    return()=>{cancelled=true}
  },[retry])

  useEffect(()=>{if(!session||demoGuest)return;let cancelled=false;setVenueError('')
    apiGet<{venues:ApiVenue[]}>('/api/admin/venues').then(r=>{if(cancelled)return;setVenues(r.venues);setVenueId(current=>r.venues.some(v=>v.id===current)?current:r.venues[0]?.id||'')})
      .catch(e=>{if(!cancelled)setVenueError(e instanceof Error?e.message:'Не удалось загрузить список заведений.')})
    return()=>{cancelled=true}
  },[session,demoGuest])

  const allVenues=venueId==='__all__'
  const selected=allVenues?null:(venues.find(v=>v.id===venueId)||venues[0]||null)
  const isSuper=session?.admin.role==='SUPER_ADMIN'
  const spaceversePanel=session?.capabilities.onboardingWorkflow===true
  const setupOnly=Boolean(!isSuper&&!venues.length&&(session?.capabilities.onboardingAccess||session?.capabilities.onboardingInvitations)&&mode==='production')
  const isTrusted=Boolean(selected?.accessKind==='trusted'&&!isSuper)
  const trustedPages=['overview','clients','operations','analytics','promotions','broadcast','audit','settings']
  const platformPage=['platform','companies','venues','developer'].includes(page)

  function startDemo(){setDemoGuest(true);setSession(DEMO_SESSION);setMode('demo');setPage('overview');setAuthState('authenticated')}
  async function signOut(){if(demoGuest){setDemoGuest(false);setSession(null);setMode('production');setAuthState('guest');return}
    try{await logout()}finally{setSession(null);setVenues([]);setVenueId('');setMode('production');setAuthState('guest')}}
  function openVenue(id:string){setVenueId(id);setMode('production');setPage('overview')}
  function switchMode(next:AppMode){
    if(next==='demo'&&!session?.capabilities.demo)return
    if(demoGuest&&next!=='demo')return
    setMode(next)
    if(next==='demo'){if(['platform','companies','venues','developer'].includes(page)&&!isSuper)setPage('overview')}
    else if(isTrusted&&!trustedPages.includes(page))setPage('overview')
    else if(!selected&&!platformPage)setPage(isSuper?'platform':'overview')
  }

  if(authState==='loading')return <main className="boot-screen"><img src="/spaceverse-mark.png" alt="SPACEVERSE" className="brand-mark" /><Database/><b>Подключение к панели управления…</b><span>Клиентские приложения продолжают работать независимо.</span></main>
  if(authState==='error')return <main className="login-shell"><section className="login-card card service-error-card">
    <div className="login-icon error"><AlertTriangle/></div><span className="eyebrow">СЕРВИС ВРЕМЕННО НЕДОСТУПЕН</span><h1>Панель управления недоступна</h1><p>{authError}</p>
    <button className="btn secondary" onClick={()=>setRetry(v=>v+1)}><RefreshCw/>Повторить</button><div className="login-safety"><ShieldCheck/><span>Приложения для гостей продолжают работать.</span></div>
  </section></main>
  if(inviteToken!==null)return <InviteAcceptance initialToken={inviteToken} session={session} onClose={()=>{setInviteToken(null);window.history.replaceState(null,'',window.location.pathname+window.location.search);setRetry(value=>value+1)}} onAccepted={(value,draftId)=>{setSession(value);setAuthState('authenticated');setOnboardingDraftId(draftId);setInviteToken(null);setPage(value.admin.role==='SUPER_ADMIN'?'platform':'overview')}}/>
  if(authState==='guest'||!session)return <Login onDemo={demoAvailable?startDemo:undefined} onInvite={invitationAvailable?()=>setInviteToken(''):undefined} onAuthenticated={s=>{setSession(s);setAuthState('authenticated');setPage(s.admin.role==='SUPER_ADMIN'?'platform':'overview')}}/>

  return <div className="app-shell">
    <PhaseCSidebar page={page} role={session.admin.role} mode={mode} restricted={isTrusted} setupOnly={setupOnly} spaceverse={session.capabilities.onboardingWorkflow===true} intakeEnabled={session.capabilities.beerIntake===true} inventoryEnabled={session.capabilities.beerInventory===true} open={mobileNav} onClose={()=>setMobileNav(false)}
      onPage={p=>{setPage(p);setBroadcastSegment('');setMobileNav(false)}}/>
    <main className="main">
      <PhaseCTopbar role={session.admin.role} adminName={session.admin.displayName} mode={mode} venues={venues} venueId={mode==='demo'?'demo-pivnik':allVenues?'__all__':selected?.id||''}
        period={period} compare={compare} restricted={isTrusted} roleLabel={setupOnly?'Доступ к панели':undefined} onMenu={()=>setMobileNav(true)} onVenue={setVenueId} onPeriod={setPeriod} onCompare={setCompare} onMode={switchMode} onLogout={()=>void signOut()} demoOnly={demoGuest} hidePeriodControls={mode==='production'&&page==='overview'}/>
      <TenantDangerContext role={session.admin.role} mode={mode} venue={mode==='production'?selected:null} onBack={()=>setPage('platform')}/>
      <div className="content">
        {mode==='demo'?<DemoMode page={page} period={period} compare={compare} onPage={setPage}/>:
        <>
          {isSuper&&page==='platform'&&session.capabilities.onboardingSupport&&<OnboardingSupportQueue key={'support:'+session.admin.id}/>}
          {session.capabilities.onboardingInvitationOwner&&['platform','companies','venues','overview'].includes(page)&&<OnboardingInvitations session={session}/>}
          {(isSuper||session.capabilities.onboardingAccess)&&session.capabilities.onboardingWorkflow&&['platform','companies','venues','overview'].includes(page)&&<OwnerVenues key={'venues:'+session.admin.id} refreshKey={String(ownerListRevision)} onVenue={openVenue} onDraft={id=>{setOnboardingDraftId(id);setOnboardingOpenRequest(value=>value+1);requestAnimationFrame(()=>document.querySelector('[aria-label="Подключение заведений"]')?.scrollIntoView({behavior:'smooth',block:'start'}))}}/>}
          {(isSuper||session.capabilities.onboardingAccess)&&session.capabilities.onboardingDrafts&&['platform','companies','venues','overview'].includes(page)&&<VenueOnboarding key={'wizard:'+session.admin.id} session={session} initialDraftId={onboardingDraftId} openRequest={onboardingOpenRequest} onChanged={refreshOwnerList}/>}
          {venueError&&<div className="error-state card"><AlertTriangle/><h3>Не удалось получить список заведений</h3><p>{venueError}</p></div>}
          {!selected&&!allVenues&&!platformPage&&!venueError&&!setupOnly&&<div className="empty card"><Database/><h3>Нет доступных заведений</h3><p>Для этой учётной записи пока не назначены заведения.</p></div>}
          {allVenues&&session.admin.role==='VENUE_ADMIN'&&page==='overview'&&<CompanyVenuesOverview venues={venues} onOpenVenue={openVenue}/>}

          {selected&&page==='overview'&&<ProductionDashboard venue={selected} period={period} compare={compare} onNavigate={setPage} spaceverse={spaceversePanel}/>}
          {selected&&page==='clients'&&<ProductionCRM key={`crm:${session.admin.id}:${selected.companyId}:${selected.id}`} venue={selected} session={session} onBroadcast={spaceversePanel?undefined:segment=>{setBroadcastSegment(segment);setPage('broadcast')}}/>}
          {selected&&page==='operations'&&<ProductionOperations venue={selected}/>}
          {selected&&page==='analytics'&&<ProductionAnalytics venue={selected} period={period}/>}
          {selected&&!isTrusted&&page==='loyalty'&&(isPivnikAppVenue(selected)&&!spaceversePanel?<AppLoyaltyManager venue={selected} session={session}/>:<LoyaltyManager venue={selected} session={session}/>)}
          {selected&&!isTrusted&&!spaceversePanel&&page==='wheel'&&(isPivnikAppVenue(selected)?<AppWheelManager venue={selected} session={session}/>:<PivnikLegacyWheelManager venue={selected}/>)}
          {selected&&!isTrusted&&!spaceversePanel&&page==='achievements'&&(isPivnikAppVenue(selected)?<AppAchievementsManager venue={selected} session={session}/>:<PivnikLegacyAchievementManager venue={selected}/>)}
          {selected&&!isTrusted&&page==='shop'&&<ShopManager venue={selected} session={session}/>}
          {selected&&page==='promotions'&&(isPivnikAppVenue(selected)&&!spaceversePanel?<AppPromotionsManager venue={selected} session={session}/>:<PromotionManager venue={selected} session={session}/>)}
          {selected&&session.capabilities.beerIntake&&!isTrusted&&page==='intake'&&<BeerIntake key={'intake:'+session.admin.id+':'+selected.id} venue={selected}/>}
          {selected&&session.capabilities.beerInventory&&!isTrusted&&page==='inventory'&&<BeerInventory key={'inventory:'+session.admin.id+':'+selected.companyId+':'+selected.id} venue={selected} actorId={session.admin.id}/>}
          {selected&&!spaceversePanel&&page==='broadcast'&&<BroadcastPage key={broadcastSegment} venue={selected} session={session} segment={broadcastSegment}/>}
          {selected&&!isTrusted&&page==='brand'&&(isPivnikAppVenue(selected)&&!spaceversePanel?<AppDesignManager venue={selected} session={session}/>:<BrandingManager venue={selected} session={session}/>)}
          {selected&&page==='settings'&&(isTrusted?<AccountSecurityPanel session={session}/>:<SettingsPage venue={selected} session={session}/>)}
          {selected&&page==='audit'&&<ProductionAudit venue={selected} superAdmin={Boolean(isSuper)}/>}

          {selected&&isTrusted&&!trustedPages.includes(page)&&!platformPage&&<div className="error-state card"><ShieldCheck/><h3>Доступ ограничен</h3><p>Директор может просматривать показатели, клиентов и операции, управлять акциями и рассылками. Системные изменения доступны владельцу.</p></div>}

          {isSuper&&page==='platform'&&<ProductionPlatform mode="platform" venues={venues} onOpenVenue={openVenue}/>}
          {isSuper&&page==='companies'&&<ProductionPlatform mode="companies" venues={venues} onOpenVenue={openVenue}/>}
          {isSuper&&page==='developer'&&<DeveloperPage/>}
          {isSuper&&page==='venues'&&<ProductionPlatform mode="venues" venues={venues} onOpenVenue={openVenue}/>}
          {!isSuper&&platformPage&&<div className="error-state card"><ShieldCheck/><h3>Нет доступа</h3><p>Этот раздел доступен только главному администратору.</p></div>}
        </>}
      </div>
    </main>
  </div>
}
