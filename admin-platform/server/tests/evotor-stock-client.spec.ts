// @vitest-environment node
import {describe,it,expect,vi} from 'vitest'
import {getEvotorStockList,getEvotorStockProduct,patchEvotorStockQuantity} from '../evotor-stock-client.js'
import {parseEvotorStockCommand} from '../evotor-stock.js'

const store='20180820-7052-4047-807D-E82C50000000',id='01ba18b6-8707-5f47-3d9c-4db058054cb2'
const makeProduct=(fields:Record<string,unknown>={})=>({
  id,store_id:store,name:'Хадыженское',type:'NORMAL',measure_name:'л',
  quantity:15.5,updated_at:'2026-10-25T10:00:00+0000',...fields,
})
const response=(obj:unknown,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/vnd.evotor.v2+json'}})

describe('real Evotor V2 product quantity adapter',()=>{
 it('reads liter products and skips pieces, unknown balances',async()=>{
   const fetcher=vi.fn().mockResolvedValue(response({items:[
     makeProduct(),makeProduct({id:'another',measure_name:'шт',quantity:5}),
     makeProduct({id:'third',quantity:null}),
   ],paging:{}}))
   const data=await getEvotorStockList(store,'fake-server-token',fetcher as typeof fetch)
   expect(data).toHaveLength(1)
   expect(data[0]).toMatchObject({name:'Хадыженское',quantity:15.5,id})
   const [url,options]=fetcher.mock.calls[0]!
   expect(url).toContain('/stores/'+store+'/products')
   expect(options.method).toBe('GET')
   expect(options.headers.Authorization).toBe('Bearer fake-server-token')
 })
 it('writes only absolute quantity and never touches prices or other goods',async()=>{
   const fetcher=vi.fn().mockResolvedValue(response(makeProduct({quantity:65.5})))
   const changed=await patchEvotorStockQuantity(store,id,'fake-server-token',65.5,fetcher as typeof fetch)
   expect(changed.quantity).toBe(65.5)
   const [url,options]=fetcher.mock.calls[0]!
   expect(url).toBe('https://api.evotor.ru/stores/'+store+'/products/'+id)
   expect(options.method).toBe('PATCH')
   expect(JSON.parse(options.body)).toEqual({quantity:65.5})
 })
 it('rejects a different store, missing stock permission, mismatched write confirmation',async()=>{
   await expect(getEvotorStockProduct(store,id,'fake',vi.fn().mockResolvedValue(response(makeProduct({store_id:'foreign'}))) as typeof fetch)).rejects.toThrow()
   await expect(getEvotorStockProduct(store,id,'fake',vi.fn().mockResolvedValue(response(makeProduct({quantity:null}))) as typeof fetch)).rejects.toThrow()
   await expect(patchEvotorStockQuantity(store,id,'fake',65.5,vi.fn().mockResolvedValue(response(makeProduct({quantity:66}))) as typeof fetch)).rejects.toThrow()
 })
 it('does not silently retry uncertain network failures',async()=>{
   const fetcher=vi.fn().mockRejectedValue(new Error('connection timeout'))
   await expect(patchEvotorStockQuantity(store,id,'fake',65.5,fetcher as typeof fetch)).rejects.toThrow()
   expect(fetcher).toHaveBeenCalledTimes(1)
 })
 it('requires exact selected product, quantity snapshot and operation UUID',()=>{
   const input={productId:id,expectedQuantity:15.5,expectedUpdatedAt:'2026-10-25T10:00:00+0000',
     liters:50,operationId:'11111111-1111-4111-8111-111111111111'}
   expect(parseEvotorStockCommand(input)).toMatchObject({delta:50000,expectedMillis:15500})
   for(const delta of [-1,0,1.1234,10001]){
     expect(()=>parseEvotorStockCommand({...input,liters:delta})).toThrow()
   }
   expect(()=>parseEvotorStockCommand({...input,storeId:'another'})).toThrow()
   expect(()=>parseEvotorStockCommand({...input,expectedQuantity:null})).toThrow()
 })
})
