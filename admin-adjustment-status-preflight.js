import { membershipRepositoryContract } from './authorization-membership-repository.js';

const REQUIRED_TYPES = Object.freeze({
  transactions: { tenant_id:'text', location_id:'text' },
  spaceverse_memberships: { user_id:'bigint', tenant_id:'text', location_id:'text', role:'text', revoked_at:'timestamp with time zone' }
});

/**
 * Manual read-only diagnostic, not an activation decision or route middleware.
 * Schema compatibility/counts cannot approve provenance, membership provisioning
 * or historical attribution. It never repairs, backfills or enables anything.
 */
export function createAdminAdjustmentStatusPreflight({ query } = {}) {
  if (typeof query !== 'function') throw new TypeError('query must be a function');
  return async function inspectStatusPrerequisites() {
    const schema = await query(
      `SELECT table_name, column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = ANY($1::text[])`,
      [Object.keys(REQUIRED_TYPES)]
    );
    if (!Array.isArray(schema?.rows)) throw new Error('Invalid schema evidence');
    const missing = [], incompatible = [];
    for (const [table, columns] of Object.entries(REQUIRED_TYPES)) {
      for (const [column, type] of Object.entries(columns)) {
        const evidence = schema.rows.filter(row=>row.table_name===table && row.column_name===column);
        if (!evidence.length) missing.push(`${table}.${column}`);
        else if (evidence.length!==1 || evidence[0].data_type!==type) incompatible.push(`${table}.${column}`);
      }
    }
    // Keep the diagnostic tied to the existing membership repository contract.
    if (membershipRepositoryContract.requiredColumns.some(column=>!Object.hasOwn(REQUIRED_TYPES.spaceverse_memberships,column))) {
      throw new Error('Membership preflight contract needs review');
    }
    const result = { schemaCompatible:!missing.length&&!incompatible.length, missing, incompatible,
      activationApproved:false, counts:null };
    if (!result.schemaCompatible) return result;
    const audit = await query(`
      SELECT
        (SELECT COUNT(*) FROM transactions WHERE mode='adjustment') AS adjustments,
        (SELECT COUNT(*) FROM transactions WHERE mode='adjustment'
          AND tenant_id IS NOT NULL AND BTRIM(tenant_id)<>''
          AND location_id IS NOT NULL AND BTRIM(location_id)<>'') AS scoped_adjustments,
        (SELECT COUNT(*) FROM transactions WHERE mode='adjustment'
          AND (tenant_id IS NULL OR location_id IS NULL OR BTRIM(tenant_id)='' OR BTRIM(location_id)='')) AS incomplete_attribution,
        (SELECT COUNT(*) FROM transactions WHERE mode='adjustment'
          AND (tenant_id IS NULL OR BTRIM(tenant_id)='') AND location_id IS NOT NULL AND BTRIM(location_id)<>'') AS location_without_tenant,
        (SELECT COUNT(*) FROM spaceverse_memberships WHERE revoked_at IS NULL) AS active_memberships,
        (SELECT COUNT(*) FROM spaceverse_memberships WHERE revoked_at IS NULL
          AND (user_id IS NULL OR tenant_id IS NULL OR BTRIM(tenant_id)='' OR role IS NULL OR role NOT IN ('owner','staff')
            OR (role='owner' AND location_id IS NOT NULL)
            OR (role='staff' AND (location_id IS NULL OR BTRIM(location_id)='')))) AS malformed_active_memberships
    `);
    if (!Array.isArray(audit?.rows) || audit.rows.length!==1) throw new Error('Invalid attribution audit evidence');
    const names=['adjustments','scoped_adjustments','incomplete_attribution','location_without_tenant','active_memberships','malformed_active_memberships'];
    const counts={};
    for (const name of names) {
      const value=audit.rows[0][name];
      if (!(typeof value==='string' && /^(0|[1-9][0-9]*)$/.test(value))
        && !(typeof value==='number' && Number.isSafeInteger(value) && value>=0)) throw new Error('Invalid audit count');
      counts[name]=String(value);
    }
    if (BigInt(counts.scoped_adjustments)+BigInt(counts.incomplete_attribution)!==BigInt(counts.adjustments)
      || BigInt(counts.location_without_tenant)>BigInt(counts.incomplete_attribution)
      || BigInt(counts.malformed_active_memberships)>BigInt(counts.active_memberships)) throw new Error('Inconsistent audit counts');
    return {...result,counts};
  };
}
