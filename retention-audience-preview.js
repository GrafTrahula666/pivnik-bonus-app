const RETENTION_SEGMENTS = new Set(['at_risk', 'sleeping']);

function normalizeSegment(value) {
  const segment = String(value || '').trim();
  if (!RETENTION_SEGMENTS.has(segment)) {
    throw new TypeError('segment must be at_risk or sleeping');
  }
  return segment;
}

export async function queryRetentionAudiencePreview(pool, segment) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool.query is required');
  const normalizedSegment = normalizeSegment(segment);
  const lifecyclePredicate = normalizedSegment === 'at_risk'
    ? `activity.operations_count > 0
       AND activity.last_activity_at < NOW() - INTERVAL '30 days'
       AND activity.last_activity_at >= NOW() - INTERVAL '60 days'`
    : `activity.operations_count > 0
       AND (activity.last_activity_at < NOW() - INTERVAL '60 days' OR activity.last_activity_at IS NULL)`;

  const result = await pool.query(`
    WITH audience AS (
      SELECT
        u.id,
        COALESCE(u.marketing_opt_in, FALSE) AS consented,
        (
          u.telegram_id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM user_identities ui
            WHERE ui.user_id = u.id AND ui.provider = 'telegram'
          )
        ) AS telegram_eligible,
        EXISTS (
          SELECT 1 FROM user_identities ui
          WHERE ui.user_id = u.id AND ui.provider = 'vk'
        ) AS vk_eligible
      FROM users u
      LEFT JOIN LATERAL (
        SELECT
          MAX(t.created_at) FILTER (
            WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
          ) AS last_activity_at,
          COUNT(*) FILTER (
            WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')
          )::int AS operations_count
        FROM transactions t
        WHERE t.client_id = u.id
      ) activity ON TRUE
      WHERE u.merged_into_user_id IS NULL
        AND u.deleted_at IS NULL
        AND ${lifecyclePredicate}
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE consented)::int AS consented,
      COUNT(*) FILTER (WHERE NOT consented)::int AS without_consent,
      COUNT(*) FILTER (WHERE consented AND telegram_eligible)::int AS telegram,
      COUNT(*) FILTER (WHERE consented AND vk_eligible)::int AS vk,
      COUNT(*) FILTER (WHERE consented AND telegram_eligible AND vk_eligible)::int AS both,
      COUNT(*) FILTER (WHERE consented AND NOT telegram_eligible AND NOT vk_eligible)::int AS no_channel
    FROM audience
  `);

  const row = result?.rows?.[0] || {};
  return Object.freeze({
    segment: normalizedSegment,
    total: Number(row.total || 0),
    consented: Number(row.consented || 0),
    withoutConsent: Number(row.without_consent || 0),
    channels: Object.freeze({
      telegram: Number(row.telegram || 0),
      vk: Number(row.vk || 0),
      both: Number(row.both || 0),
      none: Number(row.no_channel || 0)
    })
  });
}
