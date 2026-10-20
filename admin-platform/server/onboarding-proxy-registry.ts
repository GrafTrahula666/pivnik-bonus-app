import { HttpError } from './types.js'

// References only: operators register protected origins once; browser commands
// contain neither destinations nor credential-variable names.
export function resolveOnboardingProxyOrigin(runtimeKey:string,env:NodeJS.ProcessEnv=process.env):string|null{
  const raw=env.ADMIN_ONBOARDING_PROXY_REGISTRY_JSON??''
  if(!raw.trim())return null
  const invalid=()=>new HttpError(503,'ONBOARDING_PROXY_REGISTRY_INVALID','Серверное подключение заведения ещё не настроено.')
  if(Buffer.byteLength(raw)>40_000)throw invalid()
  let parsed:unknown
  try{parsed=JSON.parse(raw)}catch{throw invalid()}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length>200)throw invalid()
  const references=new Set<string>(),origins=new Set<string>()
  let result:string|null=null
  for(const [key,value] of Object.entries(parsed)){
    if(!/^sv-[0-9a-f]{32}$/.test(key)||typeof value!=='string'
      ||!/^SPACEVERSE_TENANT_PROXY_ORIGIN_[A-Z0-9_]{1,64}$/.test(value)||references.has(value))throw invalid()
    references.add(value)
    const source=env[value]
    if(!source){if(key===runtimeKey)result=null;continue}
    let url:URL
    try{url=new URL(source)}catch{throw invalid()}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'
      ||['localhost','127.0.0.1','[::1]'].includes(url.hostname)||origins.has(url.origin))throw invalid()
    origins.add(url.origin)
    if(key===runtimeKey)result=url.origin
  }
  return result
}
