import test from 'node:test'
import assert from 'node:assert/strict'
import {rankVerifiedPosProducts} from '../pos/receipt-ranking.js'
import {normalizeEvotorDocument} from '../pos/evotor-document.js'
import {sale} from './fixtures/evotor.js'

const pos=(id,{type='SELL',amount=100,productId='id-beer',name='Пиво',measure='л',quantity=1000,
    receiptNumber=5,confirmed=true,linkable=true}={})=>({
  source:'evotor',storeId:'bar',documentId:id,type,closedAt:'2026-10-02T10:00:00Z',
  amountCents:amount,receiptCount:confirmed?1:null,linkable,
  fiscal:confirmed?[{receiptNumber}]:[],clientId:null,payments:[],
  positions:[{productId,name,measure,quantityMillis:quantity,amountCents:amount}],
})
const rank=(docs)=>rankVerifiedPosProducts(docs,{storeId:'bar'})

test('only one fiscal receipt plus a complete product projection can enter the ranking',()=>{
  const verified=pos('ok',{amount:300})
  const unknown=pos('no-fiscal',{amount:9000,confirmed:false})
  const split=pos('split',{amount:1000,receiptNumber:7,linkable:false})
  const missingId=pos('no-id',{amount:500,productId:null})
  const mismatched=pos('incomplete',{amount:800})
  mismatched.positions[0].amountCents=400
  const missingNumber=pos('print-no-id',{amount:400,receiptNumber:null})
  const out=rank([verified,unknown,split,missingId,mismatched,missingNumber])
  assert.equal(out.status,'partial')
  assert.equal(out.verifiedDocuments,1)
  assert.equal(out.excludedDocuments,5)
  assert.equal(out.products[0].netCents,'300')
  assert.equal(out.categories.available,false)
  assert.equal(out.categories.items,null)
  assert.equal(out.categories.reason,'CATEGORY_NOT_IN_NORMALIZED_POS_SNAPSHOT')
  assert.equal(out.coverage,'imported_read_model_only')
})

test('verified refunds reduce rank and quantity, with BigInt totals > MAX_SAFE_INTEGER',()=>{
  const high=Number.MAX_SAFE_INTEGER-1
  const out=rank([pos('a',{amount:high,quantity:1000}),pos('b',{amount:high,quantity:1000}),
    pos('return',{type:'PAYBACK',amount:7,quantity:500}),
    pos('other',{productId:'another',name:'Другое',amount:11,quantity:1000})])
  assert.equal(out.status,'verified')
  assert.equal(out.verifiedDocuments,4)
  assert.equal(out.salesDocuments,3)
  assert.equal(out.returnDocuments,1)
  const beer=out.products.find(p=>p.productId==='id-beer')
  assert.equal(beer.netCents,String(2n*BigInt(high)-7n))
  assert.equal(beer.quantityMillis,'1500')
  assert.equal(beer.returnCents,'7')
  assert.equal(out.products[0].productId,'id-beer')
  assert.equal(out.totalRankedProducts,2)
})

test('empty imported read model is not a fabricated category ranking, unknown receipts are not zero',()=>{
  const empty=rank([])
  assert.equal(empty.status,'empty_loaded_period')
  assert.deepEqual(empty.products,[])
  const unknown=rank([pos('not-printed',{confirmed:false})])
  assert.equal(unknown.status,'unavailable_unverified')
  assert.equal(unknown.products,null)
  assert.equal(unknown.verifiedDocuments,0)
  assert.equal(unknown.excludedDocuments,1)
})

test('scope and dedup guards reject foreign store and repeated documents',()=>{
  const one=pos('one')
  assert.throws(()=>rank([one,{...one,documentId:'two',storeId:'foreign'}]),/SCOPE_MISMATCH/)
  assert.throws(()=>rank([one,one]),/SCOPE_MISMATCH/)
  assert.throws(()=>rankVerifiedPosProducts([one],{storeId:'other'}),/SCOPE_MISMATCH/)
  assert.throws(()=>rankVerifiedPosProducts([one],{storeId:'bar',limit:0}),/INVALID_RANKING_OPTIONS/)
})

test('normalizer fiscal projection can be verified without using untrusted product categories',()=>{
  const raw=sale()
  raw.body.positions[0].product_id='source-product'
  const doc=normalizeEvotorDocument(raw,'bar')
  const out=rank([doc])
  assert.equal(out.status,'verified')
  assert.equal(out.products[0].productId,'source-product')
  assert.equal(out.products[0].netCents,'30')
  assert.equal(out.categories.items,null)
})
