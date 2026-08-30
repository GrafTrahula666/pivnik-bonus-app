'use strict'

// PREPARED PATCH — not imported by the current VK/TG runtime.
// Intended for a controlled pilot inside the existing customer backend.
// It reads PostgreSQL directly; it NEVER calls Admin Platform HTTP.

function finitePercent(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}
function safeNonNegativeInt(value) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : null
}

async function resolvePivnikLoyaltyConfig(db, legacy) {
  try {
    const venue = await db.query(`
      SELECT v.id
      FROM venues v
      JOIN companies c ON c.id=v.company_id
      JOIN bars b ON b.id=v.legacy_bar_id
      WHERE c.code='pivnik' AND b.code='pivnik' AND v.active=TRUE
      LIMIT 1
    `)
    if (!venue.rowCount) return { ...legacy, source: 'legacy' }
    const venueId = venue.rows[0].id
    const [settings, levels] = await Promise.all([
      db.query(`SELECT base_cashback_percent,registration_bonus,referral_bonus FROM venue_settings WHERE venue_id=$1`, [venueId]),
      db.query(`SELECT code,title,threshold_cents,bonus_percent,discount_percent,enabled,sort_order
                FROM loyalty_levels WHERE venue_id=$1 AND enabled=TRUE ORDER BY sort_order,id`, [venueId]),
    ])
    const s = settings.rows[0]
    if (!s || !levels.rowCount) return { ...legacy, source: 'legacy' }

    const baseCashbackPercent = finitePercent(s.base_cashback_percent)
    const registrationBonus = safeNonNegativeInt(Number(s.registration_bonus))
    const referralBonus = safeNonNegativeInt(Number(s.referral_bonus))
    const parsedLevels = levels.rows.map((row) => ({
      code: String(row.code),
      name: String(row.title),
      minCents: Number(row.threshold_cents),
      bonusPercent: finitePercent(row.bonus_percent),
      discountPercent: finitePercent(row.discount_percent),
    }))
    const valid =
      baseCashbackPercent !== null &&
      registrationBonus !== null &&
      referralBonus !== null &&
      parsedLevels.every((x) =>
        Number.isSafeInteger(x.minCents) && x.minCents >= 0 &&
        x.bonusPercent !== null && x.discountPercent !== null
      ) &&
      parsedLevels.every((x, i) => i === 0 || x.minCents > parsedLevels[i - 1].minCents)

    if (!valid) return { ...legacy, source: 'legacy-invalid-db-fallback' }
    return { baseCashbackPercent, registrationBonus, referralBonus, levels: parsedLevels, source: 'db' }
  } catch (error) {
    console.error('venue config lookup failed; using legacy fallback:', error?.message || error)
    return { ...legacy, source: 'legacy-error-fallback' }
  }
}

async function resolveFeatureFlag(db, venueId, column, legacyValue) {
  const allowed = new Set([
    'wheel_enabled','shop_enabled','achievements_enabled','referrals_enabled',
    'promotions_enabled','branding_enabled',
  ])
  if (!allowed.has(column)) return legacyValue
  try {
    const result = await db.query(`SELECT ${column} AS value FROM venue_settings WHERE venue_id=$1`, [venueId])
    const value = result.rows[0]?.value
    return typeof value === 'boolean' ? value : legacyValue
  } catch {
    return legacyValue
  }
}

module.exports = { resolvePivnikLoyaltyConfig, resolveFeatureFlag }
