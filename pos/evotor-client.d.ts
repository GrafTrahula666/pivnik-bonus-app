export interface EvotorPage {
  items:unknown[]
  paging?:{next_cursor?:string|null}
}

export interface EvotorPageRequest {
  token:string
  storeId:string
  cursor:string|null
  until:string
  fetchImpl?:typeof fetch
}

export function evotorConfig(env?:NodeJS.ProcessEnv):{enabled:boolean;token:string;storeId:string}
export function fetchEvotorPage(request:EvotorPageRequest):Promise<EvotorPage>
