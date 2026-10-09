import { config } from './config.js'
import { HttpError } from './types.js'

// Business reaches the PIVNIK guest app through its /api/internal/business routes, signed with
// BUSINESS_INTERNAL_TOKEN. The app does the work itself, so its own rules always apply.

export function appLinkConfigured():boolean {
  return Boolean(config.pivnikAppUrl&&config.businessInternalToken.length>=32)
}

type Fetch=typeof fetch
let fetcher:Fetch=(...args)=>fetch(...args)
export function setAppFetchForTests(next:Fetch|null):void { fetcher=next||((...args)=>fetch(...args)) }

export interface AppCall {method?:string;body?:unknown;timeoutMs:number;errorCode:string;unreachableCode:string;failMessage:string;timeoutMessage?:string}

export async function callApp<T>(path:string,init:AppCall):Promise<T> {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),init.timeoutMs)
  try{
    const response=await fetcher(`${config.pivnikAppUrl}${path}`,{
      method:init.method||'GET',signal:controller.signal,
      headers:{'x-business-token':config.businessInternalToken,...(init.body?{'content-type':'application/json'}:{})},
      body:init.body?JSON.stringify(init.body):undefined,
    })
    const data=await response.json().catch(()=>({})) as Record<string,unknown>
    if(!response.ok){
      // The app answers a bare 404 "Not found" while its token is unset.
      if(response.status===401||(response.status===404&&(!data.error||data.error==='Not found'))) throw new HttpError(502,init.errorCode,'Приложение не принимает ключ связи: проверьте BUSINESS_INTERNAL_TOKEN на обоих сервисах.')
      const message=typeof data.error==='string'&&(response.status<500||response.status===503)?data.error:''
      throw new HttpError(response.status,init.errorCode,message||init.failMessage)
    }
    return data as T
  }catch(error){
    if(error instanceof HttpError) throw error
    throw new HttpError(502,init.unreachableCode,(error as Error)?.name==='AbortError'?(init.timeoutMessage||'Приложение не ответило вовремя.'):'Не удалось связаться с приложением.')
  }finally{clearTimeout(timer)}
}
