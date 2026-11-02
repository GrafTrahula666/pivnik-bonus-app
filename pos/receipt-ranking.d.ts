import type { PosDocument } from './analytics.js'

export interface FiscalRankDocument extends PosDocument {
  fiscal?: Array<{
    number?: string | number | null;
    receiptNumber?: string | number | null;
    fn?: string | null;
  }>;
}
export interface VerifiedProductRow {
  productId:string;name:string;measure:string;quantityMillis:string;
  salesCents:string;returnCents:string;netCents:string;
}
export interface VerifiedReceiptRanking {
  source:'evotor'
  evidence:'single_fiscal_print_and_reconciled_product_lines'
  coverage:'imported_read_model_only'
  status:'empty_loaded_period'|'unavailable_unverified'|'partial'|'verified'
  verifiedDocuments:number;excludedDocuments:number;salesDocuments:number;returnDocuments:number
  totalRankedProducts:number;products:VerifiedProductRow[]|null
  categories:{available:false;reason:'CATEGORY_NOT_IN_NORMALIZED_POS_SNAPSHOT';items:null}
}
export function rankVerifiedPosProducts(
  documents:readonly FiscalRankDocument[],
  options:{storeId:string;limit?:number}
):VerifiedReceiptRanking
