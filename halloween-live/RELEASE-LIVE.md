# Live release evidence — 30 October 2026

## Current runtime

- Railway project: `content-nature`, `20a942f9-3164-484a-a6f1-565439e38705`.
- Service: `halloween-event`, `dff4572c-04dc-42d4-9faa-650137dc6b40`.
- Domain: `https://halloween-event-production.up.railway.app`.
- Pinned code: `259c23f81077ca9f6e0239aea220ff6d864de752`.
- Deployment: `9abee987-4655-46d9-93aa-45c509124ef1`, terminal SUCCESS.
- `/health` observed `{ok:true,mode:live}`; owner login and live control state 200.
- At preparation: 169 active canonical tickets, 96 ticket-holding users,
  zero event registrations and zero event draws. Counts can increase afterward.
- Owner-approved closes_at: 30 October 2026 23:59 Europe/Moscow (20:59 UTC).
- Canonical draw stayed open; no close/draw/reveal/financial operation was run.

## Backup and preparation

Fresh `pg_dump --format=custom`, checked using `pg_restore --list`, persisted on
the dedicated `pivnik-before-halloween-20261030` volume (1000 MB).
Path: `/backups/pivnik-before-halloween-20261030.dump`; bytes: 5,444,338.
SHA-256: `25e9e5d3cbdd17b4123fd619a5829ca8287d895d395024ad926a77c683471583`.
Backup service: `77bfef9b-4dec-4ff4-b3ec-699e39718f05`.

Manual 001/002 schema/event preparation and reviewed 003 grants were applied
transactionally after that backup. Runtime role is `pivnik_halloween_live`.
Confirmed false: UPDATE users, UPDATE closes_at, DELETE audit.
Provisioning and verification helpers had their database credential references
cleared after use. Credentials and scanner-link capability are Railway variables,
not committed here. The production Mini App, CRM, kiosk and Evotor were not redeployed.

## Verification on the final runtime

- Native PostgreSQL fixture regression: 1 pass, 0 fail.
- Service regression: 13 pass, 0 fail; link scanner privilege isolation included.
- Root `node --test`: 672 tests, 671 pass, 0 fail, 1 skip (native PG separately passed).
- Root materialize twice: 0 tracked changes in the second pass; seven generated
  runtime files restored byte-for-byte afterward. `npm run check`: exit 0.
- Live owner personal short code AND `PIVNIK:<token>` resolved to the correct
  canonical user through the protected live endpoint; no client QR/PII was logged.
- Live browser: scanner opens without typing credentials via private link;
  reload works, no page errors, control remains behind login.
- Physical iPhone camera, Windows installation and physical TV remain device
  acceptance checks; browser and server tests do not replace those checks.

## Remaining limitations

Automatic bonus/deposit/frame issuance and stock deductions are not connected.
Local physical handover can be recorded. Main prize delivery must be reconciled
manually in the existing system until authorized existing APIs are connected.
Do not present a revealed winner as proof that money or a profile frame was issued.

Code remains in an isolated unmerged branch. Runtime is explicitly pinned;
future pushes cannot silently replace the live service. Roll forward/backward
only with a tested pinned commit; keep all event/canonical tables and audit.
The older `halloween-live-production.up.railway.app` remains a separate demo.
