# V21 — owner cancellation and Telegram runtime repair

- Owner/admin cancellation is unlimited; staff retain the existing per-shift cancellation limits.
- Telegram bot menu is reset to the canonical production Mini App URL on Telegram service startup.
- Stale Telegram webhook/commands from the failed bot UI experiment are removed.
- A dedicated non-Telegram test client is seeded idempotently for staff QR/accrual verification.
