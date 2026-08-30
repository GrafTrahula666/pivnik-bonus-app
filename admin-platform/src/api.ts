export type AdminRole='SUPER_ADMIN'|'VENUE_ADMIN'
export interface AdminSession {
  admin:{id:string;email:string;displayName:string;role:AdminRole}
  csrfToken:string
  capabilities:{writes:boolean;productionBonusWrites:boolean;productionAchievementWrites:boolean;productionEntitlementWrites:boolean;demo:boolean}
}
export interface ApiVenue {
  id:string;companyId:string;companyCode:string;companyName:string;code:string;name:string;address:string|null;legacyBarId:string|null
}
export class ApiError extends Error {
  status:number;code:string;details?:unknown
  constructor(status:number,code:string,message:string,details?:unknown){super(message);this.status=status;this.code=code;this.details=details}
}
let csrf=''
async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const headers=new Headers(init.headers),method=String(init.method||'GET').toUpperCase()
  if(init.body&&!headers.has('content-type'))headers.set('content-type','application/json')
  if(!['GET','HEAD'].includes(method)&&csrf)headers.set('x-csrf-token',csrf)
  const response=await fetch(path,{...init,headers,credentials:'same-origin'})
  const data=await response.json().catch(()=>({})) as Record<string,unknown>
  if(!response.ok)throw new ApiError(response.status,String(data.code||'API_ERROR'),String(data.error||`HTTP ${response.status}`),data.details)
  return data as T
}
export async function getSession(){const s=await request<AdminSession>('/api/admin/auth/session');csrf=s.csrfToken;return s}
export async function login(email:string,password:string){const s=await request<AdminSession>('/api/admin/auth/login',{method:'POST',body:JSON.stringify({email,password})});csrf=s.csrfToken;return s}
export async function logout(){await request('/api/admin/auth/logout',{method:'POST'});csrf=''}
export const apiGet=<T,>(path:string)=>request<T>(path)
export const apiPost=<T,>(path:string,body:unknown)=>request<T>(path,{method:'POST',body:JSON.stringify(body)})
export const apiPut=<T,>(path:string,body:unknown)=>request<T>(path,{method:'PUT',body:JSON.stringify(body)})
export const isAuthError=(e:unknown)=>e instanceof ApiError&&e.status===401
export const makeIdempotencyKey=(prefix:string)=>`${prefix}:${Date.now()}:${crypto.randomUUID()}`
