import type {PosReadDb} from '../../pos/repository.js'
import type {PeriodRange} from './types.js'

// Only call after resolving tenant, venue and explicitly bound Evotor store.
// No personal identifiers, raw receipts or transaction lines leave this read.
export async function loadVerifiedPosCustomerCohorts(db:PosReadDb,storeId:string,range:PeriodRange){
  if(typeof storeId!=='string'||!storeId.trim()||
     !Number.isFinite(range.from.getTime())||!Number.isFinite(range.to.getTime())||
     range.from>=range.to)throw new Error('INVALID_VERIFIED_CUSTOMER_COHORT_SCOPE')
  const result=await db.query(`
    WITH eligible AS (
      SELECT l.client_id,d.closed_at
      FROM pos_documents d
      JOIN pos_customer_links l ON l.source=d.source
        AND l.store_id=d.store_id AND l.document_id=d.document_id
      JOIN users u ON u.id=l.client_id
        AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL
      WHERE d.source='evotor' AND d.store_id=$1 AND l.store_id=$1
        AND d.type='SELL' AND d.closed_at<$3::timestamptz
        AND d.snapshot->>'linkable'='true' AND d.snapshot->>'receiptCount'='1'
        AND jsonb_array_length(CASE WHEN jsonb_typeof(d.snapshot->'fiscal')='array'
          THEN d.snapshot->'fiscal' ELSE '[]'::jsonb END)=1
        AND ((d.snapshot->'fiscal'->0->>'receiptNumber') ~ '^[1-9][0-9]{0,19}$'
          OR (d.snapshot->'fiscal'->0->>'number') ~ '^[1-9][0-9]{0,19}$')
    ), per_customer AS (
      SELECT client_id,
        COUNT(*) FILTER (WHERE closed_at >= $2::timestamptz)::bigint AS in_period,
        COUNT(*) FILTER (WHERE closed_at < $2::timestamptz)::bigint AS earlier
      FROM eligible GROUP BY client_id
    )
    SELECT
      COUNT(*) FILTER (WHERE in_period>0)::bigint AS buyers,
      COUNT(*) FILTER (WHERE in_period>0 AND earlier=0)::bigint AS first_observed,
      COUNT(*) FILTER (WHERE in_period>0 AND earlier>0)::bigint AS earlier_observed,
      COUNT(*) FILTER (WHERE in_period>=2)::bigint AS repeated_within_period
    FROM per_customer
  `,[storeId,range.from.toISOString(),range.to.toISOString()])
  if(result.rows.length!==1)throw new Error('VERIFIED_CUSTOMER_COHORT_QUERY_FAILED')
  const row=result.rows[0]!
  const count=(field:string)=>{
    const value=BigInt(String(row[field]))
    if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('VERIFIED_CUSTOMER_COUNT_OUT_OF_RANGE')
    return Number(value)
  }
  const verifiedBuyers=count('buyers')
  const firstObservedInPeriod=count('first_observed')
  const returningFromEarlierObserved=count('earlier_observed')
  const repeatWithinPeriod=count('repeated_within_period')
  if(firstObservedInPeriod+returningFromEarlierObserved!==verifiedBuyers||
    repeatWithinPeriod>verifiedBuyers)throw new Error('INVALID_VERIFIED_CUSTOMER_COHORT_TOTALS')
  return {
    source:'evotor' as const,
    identity:'confirmed_qr_to_single_fiscal_sell' as const,
    scope:'one_bound_store' as const,
    coverage:'observed_imported_verified_links_only' as const,
    firstPurchaseEverKnown:false as const,
    newCustomers:null,
    newCustomersReason:'COMPLETE_HISTORICAL_PURCHASE_IDENTITY_UNPROVEN' as const,
    verifiedBuyers,firstObservedInPeriod,returningFromEarlierObserved,repeatWithinPeriod,
  }
}
