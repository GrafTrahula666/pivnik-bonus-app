// Evotor Cloud V2 product API. Never accept a URL, store, or token from the browser.
import {HttpError} from './types.js'

export type EvotorStockProduct={
  id:string;name:string;measure_name:string;quantity:number|null;updated_at:string|null;store_id:string;type:string
}
const productIdPattern=/^[A-Za-z0-9_-]{1,200}$/
const storeIdPattern=/^[A-Za-z0-9_-]{1,200}$/
function required(condition:unknown,code:string,message:string): asserts condition {
  if(!condition)throw new HttpError(502,code,message)
}
const requestHeaders=(token:string)=>({
  Authorization:'Bearer '+token,Accept:'application/vnd.evotor.v2+json',
  'Content-Type':'application/vnd.evotor.v2+json',
})
function endpoint(storeId:string,productId?:string){
  if(!storeIdPattern.test(storeId)||productId&&!productIdPattern.test(productId))
    throw new HttpError(503,'EVOTOR_STOCK_BINDING','Идентификатор кассы или товара некорректен.')
  return 'https://api.evotor.ru/stores/'+encodeURIComponent(storeId)+'/products'+(productId?'/'+encodeURIComponent(productId):'')
}
async function fetchJson(url:string,method:'GET'|'PATCH',token:string,payload?:unknown,fetchImpl:typeof fetch=fetch){
  let response:Response
  try {
    response=await fetchImpl(url,{method,headers:requestHeaders(token),redirect:'error',
      signal:AbortSignal.timeout(12000),...(payload?{body:JSON.stringify(payload)}:{})})
  }catch{
    throw new HttpError(503,'EVOTOR_STOCK_UNCERTAIN','Нет подтверждённого ответа от Облака Эвотор. Не повторяйте поступление без сверки.')
  }
  if(!response.ok){
    if(response.status===401)throw new HttpError(503,'EVOTOR_STOCK_AUTH','Токен Эвотора недействителен.')
    if(response.status===402||response.status===403)throw new HttpError(503,'EVOTOR_STOCK_PERMISSIONS','Нет оплаченного доступа или прав product.quantity к Эвотору.')
    if(response.status===404)throw new HttpError(404,'EVOTOR_PRODUCT_NOT_FOUND','Товар не найден в выбранном магазине Эвотора.')
    if(response.status===429)throw new HttpError(429,'EVOTOR_STOCK_LIMIT','Лимит запросов Эвотора. Повторите позже.')
    throw new HttpError(502,'EVOTOR_STOCK_UNCERTAIN','Эвотор не подтвердил запись. Нужна сверка перед повтором.')
  }
  try{
    const bytes=await response.arrayBuffer()
    required(bytes.byteLength<=2_000_000,'EVOTOR_STOCK_RESPONSE','Слишком большой ответ Эвотора.')
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  }catch{
    throw new HttpError(502,'EVOTOR_STOCK_UNCERTAIN','Получен некорректный ответ Эвотора. Нужна сверка.')
  }
}
export function parseEvotorStockProduct(input:unknown,storeId:string):EvotorStockProduct{
  required(input!==null&&typeof input==='object'&&!Array.isArray(input),'EVOTOR_STOCK_RESPONSE','Некорректная карточка товара Эвотора.')
  const row=input as Record<string,unknown>
  required(typeof row.id==='string'&&productIdPattern.test(row.id)&&row.store_id===storeId
    &&typeof row.name==='string'&&row.name.length<=200&&typeof row.measure_name==='string'
    &&typeof row.type==='string','EVOTOR_STOCK_RESPONSE','Карточка товара не совпала с магазином Эвотора.')
  const quantity=row.quantity
  required(quantity===undefined||quantity===null||(typeof quantity==='number'&&Number.isFinite(quantity)&&quantity>=0&&quantity<=9_999_999.999
    &&Math.abs(quantity*1000-Math.round(quantity*1000))<.00001),'EVOTOR_STOCK_RESPONSE','Некорректный остаток товара Эвотора.')
  return {id:row.id as string,name:row.name as string,measure_name:row.measure_name as string,
    quantity:quantity==null?null:quantity as number,updated_at:typeof row.updated_at==='string'?row.updated_at:null,
    store_id:storeId,type:row.type as string}
}
export function stockInLiters(item:EvotorStockProduct):boolean{
  return item.measure_name.trim().toLowerCase()==='л'&&item.quantity!==null&&item.updated_at!==null
}
export async function getEvotorStockList(storeId:string,token:string,fetchImpl:typeof fetch=fetch){
  const result:EvotorStockProduct[]=[]
  let cursor:string|null=null
  const seen=new Set<string>()
  for(let page=0;page<20;page++){
    const url=new URL(endpoint(storeId))
    if(cursor)url.searchParams.set('cursor',cursor)
    const body=await fetchJson(url.toString(),'GET',token,undefined,fetchImpl) as Record<string,unknown>
    required(body&&typeof body==='object'&&!Array.isArray(body)&&Array.isArray(body.items)
      &&body.items.length<=1000,'EVOTOR_STOCK_RESPONSE','Некорректный каталог товаров Эвотора.')
    for(const item of body.items) {
      const product=parseEvotorStockProduct(item,storeId)
      if(seen.has(product.id))throw new HttpError(502,'EVOTOR_STOCK_RESPONSE','Дубли товаров в каталоге Эвотора.')
      seen.add(product.id)
      if(stockInLiters(product))result.push(product)
    }
    const paging=body.paging
    required(paging&&typeof paging==='object'&&!Array.isArray(paging),'EVOTOR_STOCK_RESPONSE','Некорректная страница каталога Эвотора.')
    const next=(paging as Record<string,unknown>).next_cursor
    if(next==null)return result
    required(typeof next==='string'&&next.length>0&&next.length<2048&&next!==cursor,'EVOTOR_STOCK_RESPONSE','Ошибка курсора каталога Эвотора.')
    cursor=next as string
  }
  throw new HttpError(502,'EVOTOR_STOCK_RESPONSE','Каталог товаров слишком большой для безопасной проверки.')
}
export async function getEvotorStockProduct(storeId:string,productId:string,token:string,fetchImpl:typeof fetch=fetch){
  const body=await fetchJson(endpoint(storeId,productId),'GET',token,undefined,fetchImpl)
  const product=parseEvotorStockProduct(body,storeId)
  if(product.id!==productId||!stockInLiters(product))
    throw new HttpError(409,'EVOTOR_PRODUCT_UNSUPPORTED','Товар не продаётся в литрах или нет доступа к остаткам.')
  return product
}
export async function patchEvotorStockQuantity(storeId:string,productId:string,token:string,target:number,fetchImpl:typeof fetch=fetch){
  const body=await fetchJson(endpoint(storeId,productId),'PATCH',token,{quantity:target},fetchImpl)
  const product=parseEvotorStockProduct(body,storeId)
  if(product.id!==productId||!stockInLiters(product)||Math.round(product.quantity!*1000)!==Math.round(target*1000))
    throw new HttpError(502,'EVOTOR_STOCK_UNCERTAIN','После записи Эвотор вернул другой остаток. Нужна сверка.')
  return product
}
