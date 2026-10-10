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

21 HTTP cases pass through the complete extracted pinned gateway request callback and its reachable original guards plus gateway proxy/auth functions into a real fixture Express route. Before the existing endpoint, the fixture installs extracted main `authRequired`. Membership lookup uses main's actual SQL membership repository, not an injected list. Card queries execute on PGlite using the draft's existing transaction fixture and exact migration 009. Identity, membership, wallet and audit tables are minimal fixtures.

Cases cover Telegram/VK signed owner reads, repeat, owner location filter, staff denial (including own-location filter), foreign tenant, revoked membership, legacy admin without membership, invisible customer, invalid ID/page, pagination, missing/invalid/expired bearer repository failure, missing consent (428) and unavailable child (503). Successful cards assert scoped cash, timeline and unknown wallet balance. Denials perform zero card queries; invisible customer performs visibility SQL without identity lookup. Snapshots of all six fixture tables are identical before/after the scenario sequence. The harness sets and restores its synthetic owner consent timestamp to exercise 428; those fixture setup writes are not application writes. Application queries remain guarded as SELECT-only.

The existing endpoint is a tenant manager route: staff is denied even with its own location. This is the existing permission contract, not a new regression or a grant implemented here.

## Inventory for this stage

| Function | Existing implementation | Proof | Gap | Next step |
|---|---|---|---|---|
| Signed identity | main authRequired + gateway auth/proxy | Synthetic signed TG/VK tokens through local HTTP | Provider login and process startup | Full internal Express mount proof |
| Membership | main SQL repository/resolver | Actual fixture SQL, revoked membership denied | Production membership migration/storage not enabled | Verify intended rollout separately |
| Customer card/history | draft #96 endpoint/runtime/repositories | Real Express mount + PGlite SQL | Production route remains unwired; browser untested | Existing UI controller read transport |
| Scoped wallet | draft #96 summary | Global fixture wallet is populated, response stays null | Authoritative tenant wallet binding absent | Keep unknown until binding proved |

## Limits

The complete gateway callback is extracted without changing branch order; only the card path is exercised. Original mutation guard, document selector and consent-exemption helper run for those requests. Unrelated handlers are not injected or exercised. Actual server boot/mount, production getProfile SQL, PostgreSQL service/RLS, full schema, browser and real accounts are not proven. No provider requests or production connections occur. The audit table is a fixture snapshot, not proof of production audit schema. Default disabled endpoint returns mounted:false; this is not an HTTP disabled-route test.

Validation: two complete materializations byte-identical across 395 tracked files; materialized `node --test` 436/436; `npm run check`; explicit verifier syntax check; verifier 21/21. UI and production code are unchanged. No patch retirement, merge or deploy.

Fresh `npm audit` exits 1 with six findings: body-parser/express/qs moderate, compression/source-map-js high, proxy-addr critical. package.json and package-lock.json are byte-identical to origin/main, so this validation branch introduces no dependency change. This is a fresh advisory snapshot, not the earlier three-moderate result. Dependency remediation exists separately in #213 (8df4dd8), whose release gate passed; its dependencies are not imported into this validation branch.

## Composition finding

Pinned #96 `spaceverse-server-composition.js` mounts full Customer 360 action
endpoints before reads under one `scopedModeEnabled` flag. Main and pinned #96
server entry points do not mount that composition. Thus this proof cannot
justify enabling the whole composition for a read-only rollout. No feature
flag, action handler or entry point was changed. Next bounded step: verify
the existing read endpoint against the complete internal Express routing
boundary, preserving the disabled action endpoints.
