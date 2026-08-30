# PIVNIK Admin Platform

React + Vite admin frontend and Node.js Admin API for the isolated PIVNIK staging environment. The server publishes the compiled frontend and exposes only the `/api/admin/*` namespace.

## Safety boundary

Customer applications remain independent:

```text
VK / Telegram -> existing PIVNIK backend -> production database
Admin browser -> isolated Admin API -> staging database
```

The Admin runtime is not imported by VK/TG. Staging test data is synthetic. Production database writes, production migrations, VK/TG changes, and a merge into `main` are outside this branch's scope.

## Project layout

- `src/` — React frontend, including live and Demo Mode screens.
- `server/` — authentication, tenant authorization, Admin API, write paths, and audit logging.
- `admin-migrations/` — additive PostgreSQL migrations with checksums and a legacy-schema preflight.
- `server/tests/` — security and PostgreSQL integration suites.
- `e2e/` — Playwright browser tests.
- `scripts/` — isolation checks and hard-guarded staging setup/verification.
- `artifacts/` — QA evidence and screenshots.

## Install and verify

Node.js 22 is used by the staging container.

```bash
npm install
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm run test:security
npm run test:integration
npm run test:e2e
node scripts/isolation-check.cjs
```

`package-lock.json` is committed. CI and Railway builds use `npm ci`.

## Local development

Copy only placeholder names from `.env.admin.example`; never commit a real `.env`.

```bash
npm run dev:api
npm run dev:web
```

Vite proxies `/api/admin` to `127.0.0.1:4174` during development.

## Database lifecycle

Migrations are additive and are never run automatically when the server process boots:

```text
admin-migrations/001_admin_core.sql
admin-migrations/002_configuration_foundation.sql
admin-migrations/003_phase_c_write_safety.sql
```

`server/migrate.ts` deliberately refuses to run when the legacy `public.bars` table is absent. Do not weaken this preflight.

The staging-only scripts require all of the following before they can mutate a database:

- the exact `pivnik-admin-staging` Railway project ID;
- the exact `admin-platform-staging` service ID;
- `ADMIN_ALLOW_TEST_SEED=true`;
- an internal Railway PostgreSQL hostname.

They create only synthetic staging tenants and a separate integration-test database.

## Staging deployment

- Railway project: `pivnik-admin-staging`
- Service: `admin-platform-staging`
- PostgreSQL: `admin-postgres`
- Branch: `admin-platform/staging-qa`

The root repository `Dockerfile` installs from this directory, runs the standard checks, builds both frontend and API, and starts `dist-server/index.js`. Deployment credentials and connection strings belong in Railway variables, not in Git.

## QA evidence

The controlled staging verdict and live evidence are recorded in `QA_FINAL.md`. Screenshots belong in `artifacts/screenshots/` and must be captured from the real staging URL, not from the self-contained offline preview.

See also `DO-NOT-MODIFY-PRODUCTION.md`, `ARCHITECTURE.md`, and `deploy/POSTGRES_RUNTIME_GRANTS.md`.
