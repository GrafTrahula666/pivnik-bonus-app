'use strict'

// PREPARED PATCH — not wired into production yet.
// Telemetry failure must NEVER reject or delay the primary customer action.

const ALLOWED_EVENTS = new Set([
  'app_open','auth_success','qr_view','qr_scan','bonus_earned','bonus_redeemed',
  'shop_purchase','wheel_spin','achievement_unlock','promotion_view','referral_created',
])

function recordAnalyticsEventBestEffort(db, event) {
  if (!event || !ALLOWED_EVENTS.has(event.eventType)) return
  const payload = {
    companyId: event.companyId ?? null,
    venueId: event.venueId ?? null,
    userId: event.userId ?? null,
    platform: event.platform ? String(event.platform).slice(0, 30) : null,
    eventType: event.eventType,
    properties: event.properties && typeof event.properties === 'object' ? event.properties : {},
    idempotencyKey: event.idempotencyKey ? String(event.idempotencyKey).slice(0, 160) : null,
  }

  // Queue after the current action stack. No await is returned to caller.
  queueMicrotask(() => {
    db.query(
      `INSERT INTO analytics_events(
         company_id,venue_id,user_id,platform,event_type,properties,idempotency_key
       ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT DO NOTHING`,
      [
        payload.companyId,payload.venueId,payload.userId,payload.platform,payload.eventType,
        JSON.stringify(payload.properties),payload.idempotencyKey,
      ],
    ).catch((error) => {
      console.error('best-effort analytics insert failed:', error?.message || error)
    })
  })
}

module.exports = { recordAnalyticsEventBestEffort }
