const MEMBERSHIP_SELECT_SQL = `
  SELECT
    role AS membership_role,
    tenant_id,
    location_id
  FROM spaceverse_memberships
  WHERE user_id = $1
    AND revoked_at IS NULL
  ORDER BY
    CASE role WHEN 'owner' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END,
    tenant_id,
    location_id NULLS FIRST
`;

function normalizeUserId(value) {
  if (value === null || value === undefined || value === '') {
    throw new TypeError('userId is required');
  }
  const normalized = String(value).trim();
  if (!normalized) throw new TypeError('userId must be a non-empty identifier');
  return normalized;
}

/**
 * Read-only SQL adapter for the future SPACEVERSE membership table.
 *
 * This deliberately accepts an injected query function and performs only one
 * parameterized SELECT. It is not wired into production yet: the table is a
 * schema contract for the later additive migration, not an assumption that the
 * migration already exists.
 */
export function createSqlMembershipRepository({ query }) {
  if (typeof query !== 'function') {
    throw new TypeError('query must be a function');
  }

  return async function loadMemberships(userId) {
    const normalizedUserId = normalizeUserId(userId);
    const result = await query(MEMBERSHIP_SELECT_SQL, [normalizedUserId]);

    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('membership query must resolve to an object with rows[]');
    }

    return result.rows.map((row) => Object.freeze({ ...row }));
  };
}

export const membershipRepositoryContract = Object.freeze({
  table: 'spaceverse_memberships',
  requiredColumns: Object.freeze([
    'user_id',
    'tenant_id',
    'location_id',
    'role',
    'revoked_at'
  ]),
  selectSql: MEMBERSHIP_SELECT_SQL
});
