# Evotor draft verification — 2026-10-06

Local results; none used production credentials, database or devices.

| Check | Result | Boundaries |
|---|---|---|
| Pinned main baseline, materialized `node --test` | 436/436 PASS | main `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5` |
| Integration `npm run materialize` twice | PASS | SHA256 unchanged across all 447 then-tracked files; no generated runtime rewrite committed |
| Integration `node --test` | 461/461 PASS, 0 skips/failures | Includes SQL/device/scope/HTTP scenarios; 25 more than main |
| `npm run check` including new POS modules | PASS | Syntax gate |
| `npm run verify:vk-startup-parity` | PASS | Existing prestart/materialize modes, no deployed VK/TG interaction |
| VK Hosting static bundle | PASS | Dummy `.invalid` HTTPS base, POS JS/CSS copied byte-for-byte; not deployed |
| Additive 012/013 | PASS | Applied twice on disposable PostgreSQL/WASM; not applied to production |
| Business Vitest | 61 PASS / 14 SKIP | Existing 14 integration cases need a real PostgreSQL test DB |
| Business TypeScript/API/Vite build | PASS | Compiled POS adapter imports successfully; existing >500KB chunk warning |
| Business lint | 0 errors / 10 existing warnings | No lockfile/package dependency changes |
| Root `npm audit` | FAIL: 6 (3 moderate,2 high,1 critical) | Exact vulnerability-report equality with pinned main |
| Root `npm audit --omit=dev` | FAIL: 5 (3 moderate,1 high,1 critical) | Runtime dependencies still block release |
| Business `npm audit` | FAIL: 7 (1 moderate,4 high,2 critical) | #176 lockfile byte-identical |
| Business `npm audit --omit=dev` | FAIL: 1 high | No automatic broad dependency fixes |
| Local desktop/mobile browser | NOT RUN | Chromium download failed; isolated real-component Playwright fixture added to CI |
| Local JVM/Android compilation / Keystore | NOT RUN | No local JDK/SDK. JVM tests + unsigned compile added to CI; hardware still required |
| Real Evotor API, Extras, installed app / DoD | NOT RUN / BLOCKED | Need anonymized real documents and separate test-device approval |

## Executed behaviour

- Closed SELL, anonymous SELL, same-document replay; conflict in amount, fiscal
  count or PAYBACK ancestry refuses silent overwrite. Page and cursor rollback.
- Confirmed same-client link retry keeps actor/time; different client conflicts.
  Canonical unknown/revoked QR denied. Split/unknown receipt count cannot be
  manually linked; unknown count never fabricates an average.
- PAYBACK subtracts cash, inherits only a linked base SELL from the same store,
  including return documents with unknown fiscal count. No independent QR guess.
- Explicit tenant A/location A cannot read B or another location within A.
  Viewer reads its grant but cannot issue/link/sync; global admin without grant
  cannot see scoped money; disabled binding/revoked grant deny later requests.
- Random hashed-only device key, audited atomic issue/revoke, no token in listing;
  duplicate active issuance conflicts; audit insertion failure rolls back issue.
  Feature disabled, revoked device, invalid scheme and route denied; rate limit.
- Both actual server route compositions over loopback HTTP: real signed sessions,
  expired/version-invalid sessions, consent, roles and stores; lost response
  after COMMIT then same link retry leaves exactly one link and unchanged cash.
  Device key cannot pass original Bearer user authentication. Gateway identity
  match and cross-site mutation guard exercised. Express `getProfile` is a fixture
  adapter; startup and all auth/profile joins are not reproduced.
- Workers: interruption/resume, late historical delivery on repeated full scans,
  expired token preserves earlier successful data, cursor reset, page rollback.
  Advisory-lock SQL is explicitly stubbed in WASM tests; not real concurrency proof.
- Business SQL: existing company access query, exact company/venue binding,
  30000 gross = 11000 app + 19000 anonymous cents, 1000 return, 29000 net,
  missing schema/store never uses loyalty totals; Moscow period bounds.
- Actual React component with request mocks: default all, cohort switching,
  loading, empty, stale errors, malformed success JSON, forbidden response clearing,
  venue/period change and ignored late responses. Static render confirms subset
  text, no extra cash addition and no anonymous CRM. Layout checks need a browser.
- Wallet and application journal unchanged in financial/domain/HTTP fixtures.

## CI status

New draft workflows only run checks, without deploy, DB migration, signing-key
creation or device installation. Inspect Actions on the exact draft head for
JVM/unsigned compile and desktop/mobile results. Pending or failed jobs do not
turn an unverified local result into a pass. The existing release gate must
remain red where current high/critical audits fail.

## Remaining release blockers

Real external/hardware scenario, Extras decoder based on actual namespace,
fiscal print semantics, real PostgreSQL locks/concurrency and tenant membership
HTTP startup, durable existing signing identity/approved versionCode update,
and dependency high/critical remediation. The full Definition of Done is not
met; these branches remain drafts. See `EVOTOR-INTEGRATION.md` for the approved
rollout sequence and non-destructive compensation plan.
