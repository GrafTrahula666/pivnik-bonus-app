export interface CustomerWallet {
  customer:{id:string;firstName:string|null;lastName:string|null;username:string|null;photoUrl:string|null;role:'client'}
  wallet:{balance:string;updatedAt:string}|null
}
export interface Scope {companyId:string;venueId:string}
export interface DirectoryPage {
  schemaVersion:1;scope:Scope;readStatus:'verified';runtimeStatus:'not_provisioned'
  q:string;total:string;limit:number;offset:number;hasMore:boolean;items:CustomerWallet[]
}
const invalid=()=>new Error('Не удалось подтвердить данные этого заведения. Повторите проверку.')
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw invalid()
  return value as Record<string,unknown>
}
function nullable(value:unknown):string|null{if(value!==null&&typeof value!=='string')throw invalid();return value as string|null}
export function customerWallet(raw:unknown):CustomerWallet {
  const row=object(raw),customer=object(row.customer)
  if(typeof customer.id!=='string'||!/^[1-9]\d{0,18}$/.test(customer.id)||customer.role!=='client')throw invalid()
  let wallet:CustomerWallet['wallet']=null
  if(row.wallet!==null){
    const value=object(row.wallet)
    if(typeof value.balance!=='string'||!/^\d{1,19}$/.test(value.balance)||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))throw invalid()
    wallet={balance:value.balance,updatedAt:value.updatedAt}
  }
  return {customer:{id:customer.id,firstName:nullable(customer.firstName),lastName:nullable(customer.lastName),username:nullable(customer.username),photoUrl:nullable(customer.photoUrl),role:'client'},wallet}
}
export function verifiedEnvelope(raw:unknown,scope:Scope):Record<string,unknown>{
  const value=object(raw),actual=object(value.scope)
  if(value.schemaVersion!==1||value.readStatus!=='verified'||value.runtimeStatus!=='not_provisioned'||actual.companyId!==scope.companyId||actual.venueId!==scope.venueId)throw invalid()
  return value
}
export function directoryPage(raw:unknown,scope:Scope,request:{q:string;limit:number;offset:number}):DirectoryPage {
  const value=verifiedEnvelope(raw,scope)
  if(value.q!==request.q||value.limit!==request.limit||value.offset!==request.offset||typeof value.hasMore!=='boolean'||typeof value.total!=='string'||!/^(0|[1-9]\d{0,18})$/.test(value.total)||!Array.isArray(value.items)||value.items.length>request.limit)throw invalid()
  const items=value.items.map(customerWallet),total=BigInt(value.total),until=BigInt(request.offset+items.length)
  if(new Set(items.map(item=>item.customer.id)).size!==items.length||
    (items.length>0&&until>total)||(items.length===0&&BigInt(request.offset)<total)||value.hasMore!==(until<total))throw invalid()
  return {schemaVersion:1,scope,readStatus:'verified',runtimeStatus:'not_provisioned',...request,total:value.total,hasMore:value.hasMore,items}
}
export const customerName=(row:CustomerWallet)=>[row.customer.firstName,row.customer.lastName].filter(Boolean).join(' ').trim()||row.customer.username||'Клиент №'+row.customer.id
export const formatExact=(value:string)=>value.replace(/\B(?=(\d{3})+(?!\d))/g,'\u00a0')
