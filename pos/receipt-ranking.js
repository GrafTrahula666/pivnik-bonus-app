// CHAT 09 / 83: independent rank of verified fiscal POS documents.
// Never mix these figures with the legacy all.products projection, which
// intentionally includes imported documents lacking fiscal-print evidence.
const fiscalIdentifier=(value)=>typeof value==='number'
  ? Number.isSafeInteger(value)&&value>0
  : typeof value==='string'&&/^[1-9]\d{0,19}$/.test(value);

function isVerifiedDocument(doc){
  return (doc.type==='SELL'||doc.type==='PAYBACK')&&doc.source==='evotor'&&
    doc.linkable===true&&doc.receiptCount===1&&Array.isArray(doc.fiscal)&&
    doc.fiscal.length===1&&
    (fiscalIdentifier(doc.fiscal[0]?.receiptNumber)||fiscalIdentifier(doc.fiscal[0]?.number));
}

function validPositions(doc){
  if(!Number.isSafeInteger(doc.amountCents)||doc.amountCents<0||
     !Array.isArray(doc.positions)||doc.positions.length===0)return false;
  let amount=0n;
  for(const p of doc.positions){
    if(!p||typeof p.productId!=='string'||!p.productId.trim()||
      typeof p.name!=='string'||!p.name.trim()||typeof p.measure!=='string'||
      !Number.isSafeInteger(p.quantityMillis)||p.quantityMillis<=0||
      !Number.isSafeInteger(p.amountCents)||p.amountCents<0)return false;
    amount+=BigInt(p.amountCents);
  }
  // This is a ranked line-item projection, not an inferred amount allocation.
  return amount===BigInt(doc.amountCents);
}

/**
 * Input MUST be read through an authenticated, company/venue-bound store.
 * This guard rejects a mismatched store and repeat delivery rather than
 * leaking/cross-summing data from a different tenant.
 */
export function rankVerifiedPosProducts(documents,{storeId,limit=50}={}){
  if(typeof storeId!=='string'||!storeId.trim()||
    !Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_RANKING_OPTIONS');
  if(!Array.isArray(documents))throw Error('INVALID_RANKING_DOCUMENTS');
  const seen=new Set(), items=new Map();
  let verifiedDocuments=0,excludedDocuments=0,salesDocuments=0,returnDocuments=0;
  for(const doc of documents){
    if(!doc||doc.storeId!==storeId||typeof doc.documentId!=='string'||!doc.documentId.trim()||
      seen.has(doc.documentId))throw Error('RANKING_STORE_OR_DOCUMENT_SCOPE_MISMATCH');
    seen.add(doc.documentId);
    if(!isVerifiedDocument(doc)||!validPositions(doc)){excludedDocuments++;continue;}
    verifiedDocuments++;
    const returning=doc.type==='PAYBACK',sign=returning?-1n:1n;
    if(returning)returnDocuments++;else salesDocuments++;
    for(const p of doc.positions){
      // Never conflate goods with equal display names but distinct POS IDs.
      const key=JSON.stringify([p.productId,p.name,p.measure]);
      const item=items.get(key)||{productId:p.productId,name:p.name,measure:p.measure,
        quantityMillis:0n,salesCents:0n,returnCents:0n};
      item.quantityMillis+=sign*BigInt(p.quantityMillis);
      item[returning?'returnCents':'salesCents']+=BigInt(p.amountCents);
      items.set(key,item);
    }
  }
  const ranked=[...items.values()].map(p=>({
    productId:p.productId,name:p.name,measure:p.measure,
    quantityMillis:String(p.quantityMillis),salesCents:String(p.salesCents),
    returnCents:String(p.returnCents),netCents:String(p.salesCents-p.returnCents),
  })).sort((a,b)=>{
    const av=BigInt(a.netCents),bv=BigInt(b.netCents);
    return av===bv?a.productId.localeCompare(b.productId)||a.name.localeCompare(b.name)||
      a.measure.localeCompare(b.measure):av>bv?-1:1;
  });
  const status=documents.length===0?'empty_loaded_period':verifiedDocuments===0?'unavailable_unverified':
    excludedDocuments>0?'partial':'verified';
  return {
    source:'evotor',evidence:'single_fiscal_print_and_reconciled_product_lines',
    coverage:'imported_read_model_only',status,
    verifiedDocuments,excludedDocuments,salesDocuments,returnDocuments,
    totalRankedProducts:ranked.length,products:verifiedDocuments===0&&documents.length>0?null:ranked.slice(0,limit),
    // No category ID/classification is stored in the immutable POS snapshot.
    // Guessing from product names is not evidence; category ranking stays unavailable.
    categories:{available:false,reason:'CATEGORY_NOT_IN_NORMALIZED_POS_SNAPSHOT',items:null},
  };
}
