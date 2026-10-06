# Customer 360: signed HTTP and SQL proof

Validation only. No route enablement or draft implementation imported into main.

## Reproduce

Install the existing package-lock dependencies. Make sure these exact commits exist locally:
- main: `18a0fa4e5d911952a7993c432a6e7fc50de9e8c5`
- draft #96: `e2c5e522bac74a4567f7cc47052c0f1b28abf320`

Fetch the existing `spaceverse/tenant-read-isolation-20260912` branch if needed, then run:

```sh
node scripts/verify-customer360-http-sql.mjs
```

The verifier archives the pinned draft into a disposable temporary directory. It imports only its existing Customer 360 endpoint/runtime/read repositories and their dependencies, executes no patch scripts, and removes the archive and in-memory PGlite database. Both HTTP listeners bind loopback on ephemeral ports. No production configuration or secret is read.

## Evidence

19 HTTP cases pass through extracted pinned gateway proxy/auth functions into a real fixture Express route. Before the existing endpoint, the fixture installs extracted main `authRequired`. Membership lookup uses main's actual SQL membership repository, not an injected list. Card queries execute on PGlite using the draft's existing transaction fixture and exact migration 009. Identity, membership, wallet and audit tables are minimal fixtures.

Cases cover Telegram/VK signed owner reads, repeat, owner location filter, staff denial (including own-location filter), foreign tenant, revoked membership, legacy admin without membership, invisible customer, invalid ID/page, pagination, missing/invalid/expired bearer and repository failure. Successful cards assert scoped cash, timeline and unknown wallet balance. Denials perform zero card queries; invisible customer performs visibility SQL without identity lookup. Snapshots of all six fixture tables are identical before/after reads.

The existing endpoint is a tenant manager route: staff is denied even with its own location. This is the existing permission contract, not a new regression or a grant implemented here.

## Inventory for this stage

| Function | Existing implementation | Proof | Gap | Next step |
|---|---|---|---|---|
| Signed identity | main authRequired + gateway auth/proxy | Synthetic signed TG/VK tokens through local HTTP | Full production gateway callback/provider login | Full-router disposable proof |
| Membership | main SQL repository/resolver | Actual fixture SQL, revoked membership denied | Production membership migration/storage not enabled | Verify intended rollout separately |
| Customer card/history | draft #96 endpoint/runtime/repositories | Real Express mount + PGlite SQL | Production route remains unwired; browser untested | Existing UI controller read transport |
| Scoped wallet | draft #96 summary | Global fixture wallet is populated, response stays null | Authoritative tenant wallet binding absent | Keep unknown until binding proved |

## Limits

The final gateway auth/consent gate is recreated for the fixture route. The full gateway callback, actual server boot/mount, production getProfile SQL, PostgreSQL service/RLS, full schema, browser and real accounts are not proven. No provider requests or production connections occur. The audit table is a fixture snapshot, not proof of production audit schema. Default disabled endpoint returns mounted:false; this is not an HTTP disabled-route test.

Validation: two complete materializations byte-identical across 393 tracked files; materialized `node --test` 436/436; `npm run check`; explicit verifier syntax check; verifier 19/19. UI and production code are unchanged. No patch retirement, merge or deploy.

Fresh `npm audit` exits 1 with six findings: body-parser/express/qs moderate, compression/source-map-js high, proxy-addr critical. package.json and package-lock.json are byte-identical to origin/main, so this validation branch introduces no dependency change. This is a fresh advisory snapshot, not the earlier three-moderate result. Dependency remediation is a separate next priority, outside this read-only validation PR.
