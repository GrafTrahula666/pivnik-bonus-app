# Bounded VK gateway CORS observation — 2026-10-03

Stage: fix a confirmed diagnostic regression, not the production gateway.
Main was fetched at 18a0fa4e5d911952a7993c432a6e7fc50de9e8c5.
Existing worktrees were preserved; no draft implementation was incorporated.
MODULE-MAP and starter/knowledge-base were previously read; no applicable AGENTS.md found.
Open PRs and origin branches were refreshed. Existing gateway observation branch
`automation/vk-gateway-probe-main-20260929-v2` has the same unbounded OPTIONS request.
The prior cancellation verifier #191 now has a green release gate.

## Evidence and change

[Public observation run](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37122071915)
reported gateway TCP timeout and CORS ETIMEDOUT after 136468ms on 2026-10-03.
Unlike GET and transport probes, OPTIONS had no absolute deadline. It now destroys
its request with PROBE_TIMEOUT after 15000ms and clears the timer on close.
The named local function permits isolated tests without running public probes.
No runtime routes, UI, gateway configuration, dependencies, env or patch scripts change.
This bounds failure diagnosis for the owner; it does not restore venue access.

## Inventory / next action

| Function | Existing implementation | Verified here | Gap | Next small step |
|---|---|---|---|---|
| Cash/Evotor | Draft #174, sales dashboards | Branch/PR evidence only | Real import/runtime unavailable | Review confirmed receipt/return reconciliation |
| Dashboard/CRM | main directory/summary; Business #176 | Main regression suite | Business venue adapter still draft | Verify one read scenario after integration |
| Customer 360 | #115, tenant foundation #96 | Existing branch/PR evidence | Not integrated or enabled | Review tenant read boundary |
| Bonus adjustments | Main + fixes #182/#184; SQL #183 | Existing verified drafts, not integrated here | Production retains main behavior | Review existing fixes before new work |
| Cancellation | #185–#189; joint verifier #191 | #191 CI green | Drafts remain unmerged | Review combined stage evidence |
| Telegram campaigns | Main broadcast store and draft flows | Main regression suite only | Real provider sending unverified | Verify retry with provider fixtures |
| Achievements/frames | Main engine/personal frames, Business grants | Main regression suite only | Tenant grant integration unverified | Verify audited grant scenario |
| Rights/audit | Main legacy roles/journal; scoped #96 | Main regression suite only | Tenant foundation gated/unmerged | Verify cross-tenant denial after integration |
| VK reachability | Existing public network observer/runbook | Real local TLS stall + public read-only probe | Gateway path failing; server access unavailable | Read-only Selectel/Caddy/relay diagnosis |

## Validation

- New tests: 4/4 — actual local TCP stall before TLS handshake, 204/origin,
  403/no origin, ECONNREFUSED, default 15000ms and timer cleanup.
- `npm run materialize` twice: pass; SHA-256 of every tracked file identical.
- Materialized `node --test`: 440/440, no failures/skips.
- `npm run check`, VK startup parity and `git diff --check`: pass.
- `npm audit`: existing 3 moderate findings in qs/body-parser/express; separate #180.
- Generated runtime changes restored. Focused tests pass again on canonical source.
- Read-only public observation at 2026-10-03T14:10:17.133Z: Railway VK 13 and
  Telegram 11 requests satisfy expected statuses/assets. Gateway health/ready/OPTIONS
  return 502 from this execution network; OPTIONS settles in 8534ms.
  Local DNS resolver returns ECONNREFUSED; transport ERR_PROXY_TUNNEL. Thus this
  vantage cannot distinguish direct gateway behavior from outbound proxy failure.
  Previous GitHub runner TCP timeouts are independent evidence of failed reachability.
  Existing no-AAAA warning must not be treated as proof when DNS itself failed.

## Limits

No signed production session, mobile carrier/VPN comparison, Selectel host/Caddy logs,
account billing, relay upstream or production tenant isolation was inspected.
UI was untouched, so no new desktop/mobile assertion. Sensitive mutations/replay and
provider messaging do not apply to a read-only OPTIONS deadline. No production
writes, deployment, merge or infrastructure changes. The broad improvement task
continues; gateway repair requires confirmed server-side evidence.

## Follow-up: isolate the failed hop (2026-10-03)

- [Release gate #1682](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37128809872)
  passed for a09f9b9040b91d549d93027866c10d9d6f0a38a6.
- [Independent GitHub observation #250](https://github.com/GrafTrahula666/pivnik-bonus-app/actions/runs/37128809899),
  first attempt at 14:12:54 UTC: A resolves to 139.100.238.159, AAAA ENODATA;
  IPv4 transport PROBE_TIMEOUT after 15001ms, health/ready CONNECT_TIMEOUT
  after about 10255ms; CORS PROBE_TIMEOUT after 15007ms. The new deadline
  is therefore observed on an actual failed public connection.
- Rerun of the same read-only observation on an independent GitHub runner
  at 15:02:24 UTC confirms the failure persists: A resolves, IPv4 transport
  times out at 15001ms; health/ready CONNECT_TIMEOUT at 10492ms; OPTIONS
  PROBE_TIMEOUT at 15008ms. No deploy job was rerun.
- Direct server-to-server relay GET /api/health at 14:59:57 UTC and
  /api/platform-health at 15:01:19 UTC both return 200, ok=true,
  the latter vk=true. Release remains main 18a0fa4. No signed user request.
- Vercel production log aggregation since 14:00 UTC returned no entries.
  This is missing observability, not evidence that no requests occurred.
- Source inspection: gateway /healthz returns local 200 and validated
  OPTIONS returns local 204 before the upstream fetch. Neither needs
  Railway, the relay or PostgreSQL. Assuming deployed routing matches the
  runbook, the combined evidence focuses investigation on public TCP/TLS,
  Caddy and the gateway process, rather than database mutations. Source
  inspection cannot prove the deployed gateway matches this source.

Next read-only host checks, when authenticated Selectel access is available:
check host power/network/security-group state and TCP 443 exposure; inspect
Caddy/gateway container status and recent error logs; compare local gateway
health on port 8080 with HTTPS health on 443; only after local health works,
compare readiness and relay access. Do not restart, alter firewall, redeploy,
rotate secrets or write production data as part of these checks.

No authenticated Selectel host/log surface is available in this session.
Billing/power/firewall/certificates/container health and actual Russian
client reachability remain unconfirmed. No gateway repair is claimed.

Follow-up verification: materialize twice with identical tracked SHA-256;
440/440 tests, check, VK parity and diff-check pass again. Audit retains the
same three moderate findings. Generated changes restored; this follow-up
changes only this report.
