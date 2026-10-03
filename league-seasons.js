// Read-only archive: the same purchase totals, merged accounts and privacy as the league.
export async function getLeagueSeasons(db, currentUserId, profileFrameFromRow, asOf = null) {
  const result = await db.query(`
    WITH RECURSIVE user_map AS (
      SELECT id AS source_id, id AS canonical_id
      FROM users WHERE merged_into_user_id IS NULL
      UNION ALL
      SELECT u.id, m.canonical_id
      FROM users u JOIN user_map m ON u.merged_into_user_id = m.source_id
    ), monthly_spend AS (
      SELECT um.canonical_id AS user_id,
             date_trunc('month', t.created_at AT TIME ZONE 'Europe/Moscow') AS month,
             SUM(t.cash_paid_cents)::bigint AS spend_cents
      FROM transactions t JOIN user_map um ON um.source_id = t.client_id
      WHERE t.status = 'completed' AND t.mode IN ('accrue', 'redeem')
        AND t.created_at < (date_trunc('month', COALESCE($2::timestamptz, NOW())
          AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow')
      GROUP BY um.canonical_id, month
    ), ranked AS (
      SELECT u.*, ms.month, ms.spend_cents,
             ROW_NUMBER() OVER (PARTITION BY ms.month ORDER BY ms.spend_cents DESC, u.id ASC) AS rank
      FROM monthly_spend ms JOIN users u ON u.id = ms.user_id
      WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL AND ms.spend_cents > 0
    )
    SELECT id, first_name, last_name, photo_url, avatar_source, avatar_key,
           profile_frame, role, telegram_id, unlimited_bonus,
           profile_public, show_name, show_avatar, show_leaderboard_amount,
           spend_cents, rank, to_char(month, 'YYYY-MM') AS month_code,
           id = (SELECT canonical_id FROM user_map WHERE source_id = $1::bigint) AS is_me
    FROM ranked WHERE rank <= 3 ORDER BY month DESC, rank ASC
  `, [currentUserId, asOf]);
  const seasons = [];
  for (const row of result.rows) {
    let season = seasons.at(-1);
    if (season?.monthCode !== row.month_code) {
      season = {
        monthCode: row.month_code,
        month: new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
          .format(new Date(`${row.month_code}-15T12:00:00Z`)),
        leaders: []
      };
      seasons.push(season);
    }
    const isMe = Boolean(row.is_me);
    const isPublic = row.profile_public !== false;
    const showName = isMe || (isPublic && row.show_name !== false);
    const showAvatar = isMe || (isPublic && row.show_avatar !== false);
    const showSpend = isMe || (isPublic && row.show_leaderboard_amount !== false);
    const name = `${String(row.first_name || '').trim() || 'Гость'}${row.last_name ? ` ${String(row.last_name).trim().slice(0, 1)}.` : ''}`;
    season.leaders.push({
      rank: Number(row.rank), name: showName ? name : 'Скрытый гость',
      spend: showSpend ? Number(row.spend_cents) / 100 : null, isMe,
      avatarSource: showAvatar ? (row.avatar_source || 'preset_male') : null,
      avatarKey: showAvatar ? (row.avatar_key || null) : null,
      photoUrl: showAvatar ? (row.photo_url || null) : null,
      profileFrame: showAvatar ? profileFrameFromRow(row) : 'none', showAvatar
    });
  }
  return { seasons };
}
