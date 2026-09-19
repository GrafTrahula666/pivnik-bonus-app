const ADMIN_USER_ROLES = new Set(['client', 'staff', 'viewer', 'admin']);
const ADMIN_USER_STATUSES = new Set(['new', 'active', 'inactive', 'no_ops']);

function readParam(input, key) {
  if (!input) return '';
  if (typeof input.get === 'function') return input.get(key) ?? '';
  const value = input[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function normalizeAdminUserDirectoryInput(input = {}) {
  const rawQ = String(readParam(input, 'q') || '').trim();
  const rawRole = String(readParam(input, 'role') || '').trim();
  const rawStatus = String(readParam(input, 'status') || '').trim();
  const rawPage = String(readParam(input, 'page') || '').trim();
  const rawLimit = String(readParam(input, 'limit') || '').trim();

  const controlled = Boolean(rawQ || rawRole || rawStatus || rawPage || rawLimit);
  const q = rawQ.slice(0, 120);
  const role = ADMIN_USER_ROLES.has(rawRole) ? rawRole : '';
  const status = ADMIN_USER_STATUSES.has(rawStatus) ? rawStatus : '';
  const page = clampInt(rawPage, 1, 1, 100_000);
  const limit = rawLimit
    ? clampInt(rawLimit, 25, 5, 100)
    : controlled ? 25 : 200;

  return { q, role, status, page, limit };
}

export function adminUserCrmStatus(row, nowMs = Date.now()) {
  const createdMs = Date.parse(row?.created_at || row?.createdAt || '');
  const lastActivityMs = Date.parse(row?.last_activity_at || row?.lastActivityAt || '');
  const operationsCount = Number(row?.operations_count ?? row?.operationsCount ?? 0);
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  if (Number.isFinite(createdMs) && createdMs >= nowMs - sevenDays) return 'new';
  if (operationsCount <= 0) return 'no_ops';
  if (Number.isFinite(lastActivityMs) && lastActivityMs >= nowMs - thirtyDays) return 'active';
  return 'inactive';
}

export async function queryAdminUserDirectory(pool, input = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool.query is required');

  const filters = normalizeAdminUserDirectoryInput(input);
  const params = [];
  const where = [
    'u.merged_into_user_id IS NULL',
    'u.deleted_at IS NULL'
  ];

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(`(
      CONCAT_WS(' ', u.first_name, u.last_name) ILIKE ${p}
      OR COALESCE(u.username, '') ILIKE ${p}
      OR COALESCE(u.telegram_id::text, '') ILIKE ${p}
      OR EXISTS (
        SELECT 1
        FROM user_identities ui_search
        WHERE ui_search.user_id = u.id
          AND ui_search.provider_user_id::text ILIKE ${p}
      )
    )`);
  }

  if (filters.role) {
    params.push(filters.role);
    where.push(`u.role = $${params.length}`);
  }

  if (filters.status === 'new') {
    where.push(`u.created_at >= NOW() - INTERVAL '7 days'`);
  } else if (filters.status === 'no_ops') {
    where.push(`u.created_at < NOW() - INTERVAL '7 days' AND COALESCE(activity.operations_count, 0) = 0`);
  } else if (filters.status === 'active') {
    where.push(`u.created_at < NOW() - INTERVAL '7 days'
      AND COALESCE(activity.operations_count, 0) > 0
      AND activity.last_activity_at >= NOW() - INTERVAL '30 days'`);
  } else if (filters.status === 'inactive') {
    where.push(`u.created_at < NOW() - INTERVAL '7 days'
      AND COALESCE(activity.operations_count, 0) > 0
      AND activity.last_activity_at < NOW() - INTERVAL '30 days'`);
  }

  const fromSql = `
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT
        MAX(t.created_at) FILTER (WHERE t.status = 'completed') AS last_activity_at,
        COUNT(*) FILTER (WHERE t.status = 'completed')::int AS operations_count
      FROM transactions t
      WHERE t.client_id = u.id
    ) activity ON TRUE
    WHERE ${where.join(' AND ')}
  `;

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total ${fromSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / filters.limit));
  const page = Math.min(filters.page, pages);
  const offset = (page - 1) * filters.limit;

  const dataParams = [...params, filters.limit, offset];
  const limitParam = `$${dataParams.length - 1}`;
  const offsetParam = `$${dataParams.length}`;
  const orderSql = filters.limit === 200
    ? 'u.created_at DESC, u.id DESC'
    : 'COALESCE(activity.last_activity_at, u.created_at) DESC, u.created_at DESC, u.id DESC';

  const result = await pool.query(
    `SELECT
        u.id,
        u.telegram_id,
        u.username,
        u.first_name,
        u.last_name,
        u.role,
        u.created_at,
        u.qr_short_code,
        u.unlimited_bonus,
        u.profile_frame,
        w.balance,
        bl.paid_ml_total,
        bl.gift_ml_balance,
        (u.staff_pin_hash IS NOT NULL AND u.staff_pin_salt IS NOT NULL) AS pin_configured,
        activity.last_activity_at,
        COALESCE(activity.operations_count, 0)::int AS operations_count,
        (SELECT ui.provider_user_id
         FROM user_identities ui
         WHERE ui.user_id = u.id AND ui.provider = 'vk'
         LIMIT 1) AS vk_id,
        ARRAY(
          SELECT ui.provider
          FROM user_identities ui
          WHERE ui.user_id = u.id
          ORDER BY ui.provider
        ) AS linked_platforms
     ${fromSql}
     ORDER BY ${orderSql}
     LIMIT ${limitParam}
     OFFSET ${offsetParam}`,
    dataParams
  );

  return {
    rows: result.rows,
    pagination: {
      page,
      limit: filters.limit,
      total,
      pages
    },
    filters
  };
}
