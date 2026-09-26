const ADMIN_USER_ROLES = new Set(['client', 'staff', 'viewer', 'admin']);
const ADMIN_USER_STATUSES = new Set(['new', 'active', 'at_risk', 'sleeping', 'no_visits', 'inactive', 'no_ops']);

export function isAdminUserUrlLike(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  return /^(?:https?:\/\/|www\.)/i.test(text)
    || /\b(?:https?:\/\/|www\.)/i.test(text)
    || /^[^\s@]+\.[a-z]{2,}(?:[/?#]|$)/i.test(text);
}

export function adminUserDisplayUsername(value) {
  const username = String(value ?? '').trim().replace(/^@/, '');
  return username && !isAdminUserUrlLike(username) ? username : null;
}

export function adminUserDisplayName(row = {}) {
  const name = [row.first_name, row.last_name]
    .map((value) => String(value ?? '').trim())
    .filter((value) => value && !isAdminUserUrlLike(value))
    .join(' ')
    .trim();
  if (name) return name;

  const username = adminUserDisplayUsername(row.username);
  if (username) return username;
  if (row.telegram_id !== null && row.telegram_id !== undefined && String(row.telegram_id)) return 'Пользователь Telegram';
  if (row.vk_id !== null && row.vk_id !== undefined && String(row.vk_id)) return 'Пользователь VK';
  return `Пользователь #${String(row.id || '—')}`;
}

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
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const sixtyDays = 60 * 24 * 60 * 60 * 1000;

  if (operationsCount <= 0) {
    return Number.isFinite(createdMs) && createdMs >= nowMs - thirtyDays ? 'new' : 'no_visits';
  }
  if (!Number.isFinite(lastActivityMs)) return 'sleeping';
  if (lastActivityMs >= nowMs - thirtyDays) return 'active';
  if (lastActivityMs >= nowMs - sixtyDays) return 'at_risk';
  return 'sleeping';
}

export async function queryAdminUserDirectory(pool, input = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('pool.query is required');

  const filters = normalizeAdminUserDirectoryInput(input);
  const params = [];
  const baseWhere = [
    'u.merged_into_user_id IS NULL',
    'u.deleted_at IS NULL'
  ];

  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    baseWhere.push(`(
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
    baseWhere.push(`u.role = $${params.length}`);
  }

  const where = [...baseWhere];
  if (filters.status === 'new') {
    where.push(`u.created_at >= NOW() - INTERVAL '30 days' AND COALESCE(activity.operations_count, 0) = 0`);
  } else if (filters.status === 'no_visits' || filters.status === 'no_ops') {
    where.push(`u.created_at < NOW() - INTERVAL '30 days' AND COALESCE(activity.operations_count, 0) = 0`);
  } else if (filters.status === 'active') {
    where.push(`COALESCE(activity.operations_count, 0) > 0
      AND activity.last_activity_at >= NOW() - INTERVAL '30 days'`);
  } else if (filters.status === 'at_risk') {
    where.push(`COALESCE(activity.operations_count, 0) > 0
      AND activity.last_activity_at < NOW() - INTERVAL '30 days'
      AND activity.last_activity_at >= NOW() - INTERVAL '60 days'`);
  } else if (filters.status === 'sleeping') {
    where.push(`COALESCE(activity.operations_count, 0) > 0
      AND (activity.last_activity_at < NOW() - INTERVAL '60 days' OR activity.last_activity_at IS NULL)`);
  } else if (filters.status === 'inactive') {
    where.push(`COALESCE(activity.operations_count, 0) > 0
      AND activity.last_activity_at < NOW() - INTERVAL '30 days'`);
  }

  const activityJoinSql = `
    FROM users u
    JOIN wallets w ON w.user_id = u.id
    LEFT JOIN beer_loyalty bl ON bl.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT
        MAX(t.created_at) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem')) AS last_activity_at,
        COUNT(*) FILTER (WHERE t.status = 'completed' AND t.mode IN ('accrue','redeem'))::int AS operations_count
      FROM transactions t
      WHERE t.client_id = u.id
    ) activity ON TRUE`;
  const fromSql = `${activityJoinSql}
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

  const segmentResult = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE u.created_at >= NOW() - INTERVAL '30 days' AND COALESCE(activity.operations_count, 0) = 0)::int AS new,
       COUNT(*) FILTER (WHERE COALESCE(activity.operations_count, 0) > 0 AND activity.last_activity_at >= NOW() - INTERVAL '30 days')::int AS active,
       COUNT(*) FILTER (WHERE COALESCE(activity.operations_count, 0) > 0 AND activity.last_activity_at < NOW() - INTERVAL '30 days' AND activity.last_activity_at >= NOW() - INTERVAL '60 days')::int AS at_risk,
       COUNT(*) FILTER (WHERE COALESCE(activity.operations_count, 0) > 0 AND (activity.last_activity_at < NOW() - INTERVAL '60 days' OR activity.last_activity_at IS NULL))::int AS sleeping,
       COUNT(*) FILTER (WHERE u.created_at < NOW() - INTERVAL '30 days' AND COALESCE(activity.operations_count, 0) = 0)::int AS no_visits
     ${activityJoinSql}
     WHERE ${baseWhere.join(' AND ')}`,
    params
  );
  const segmentRow = segmentResult.rows[0] || {};
  const segments = {
    new: Number(segmentRow.new || 0),
    active: Number(segmentRow.active || 0),
    at_risk: Number(segmentRow.at_risk || 0),
    sleeping: Number(segmentRow.sleeping || 0),
    no_visits: Number(segmentRow.no_visits || 0)
  };

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
    segments,
    filters
  };
}
