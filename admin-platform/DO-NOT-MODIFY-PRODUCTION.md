# Production isolation / do-not-modify list

This Phase B package was intentionally developed outside the production repository.

No current production file has been modified.

## Current PIVNIK entrypoints that remain untouched

From the inspected production repository:

- `universal-server.js`
- `server.js`
- `app.js`
- `index.html`
- `styles.css`
- `vk-platform.js`
- `account-link.js`
- `platform-core.js`
- `qr-resolver.js`
- `achievements.js`
- `wheel.js`
- `railway.json`
- existing `migrations/*`
- production repair/deploy scripts under `scripts/*`

## Existing production DB structures that this package does not rename/remove

Including:

- users
- wallets
- beer_loyalty
- transactions
- bars
- bar_customers
- user_identities
- reward_grants
- user_achievements_v2
- user_frames
- wheel_spins
- wheel_annual_prizes
- shop_items
- shop_purchases
- promotions
- app_settings
- QR/session/shift/support/account-link tables

Admin migrations are additive only.

## Existing customer behavior that is not changed

- VK authentication
- Telegram authentication
- platform-separated account behavior
- customer sessions
- bootstrap
- QR generation/use
- bonus accrual
- bonus redemption
- beer loyalty
- existing achievements
- existing wheel
- existing shop
- current promotions
- current published design
- owner/special-user logic
- Railway customer service healthcheck/startup

## Deployment rule

Do not place the Admin service start command into the existing PIVNIK Railway services.

Do not change their `npm start`.

Admin must be deployed as a new service with its own:
- root directory / package;
- environment variables;
- domain;
- start command;
- `/api/admin/health`.

Production deployment remains explicitly unauthorized at this stage.
