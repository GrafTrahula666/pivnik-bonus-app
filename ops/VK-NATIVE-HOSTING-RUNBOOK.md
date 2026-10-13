# VK Native Hosting production runbook

## Current production architecture

`vk.ru/app54694987 -> VK Mini Apps Hosting -> Selectel HTTPS gateway -> Vercel server relay -> Railway VK backend -> PostgreSQL`

The browser must not load Railway or Vercel directly.

Current fixed gateway:

`https://139.100.238.159.nip.io`

Current production VK Hosting URL observed on 2026-09-19:

`https://prod-app54694987-989ea78abfeb.pages-ac.vk-apps.ru/index.html`

The public user/QR link remains:

`https://vk.ru/app54694987`

VK App ID remains `54694987`.

## Important origin rules

VK DEV Hosting uses hosts like:

`stage-app54694987-<hash>.pages.vk-apps.ru`

VK production Hosting uses hosts like:

`prod-app54694987-<hash>.pages-ac.vk-apps.ru`

The Selectel gateway must allow both `*.pages.vk-apps.*` and `*.pages-ac.vk-apps.*`.
Rejecting `pages-ac` causes the VK shell to open but API preflight to fail with:

`403 {"ok":false,"error":"VK Hosting Origin is required."}`

## Verified production fix

On 2026-09-19 production was verified after the Selectel gateway hotfix:

- VK production Hosting returned 200;
- JS/CSS/assets loaded from VK Hosting;
- browser bundle contained Selectel API base and no `*.up.railway.app` browser origin;
- Selectel `/healthz` and `/readyz` passed;
- production VK CORS preflight to Selectel passed;
- a real iPhone VK session produced `VK_BRIDGE_INIT_OK`, `VK_AUTH_SUCCESS`, `VK_BOOT_COMPLETE`, `VK_PROFILE_SUCCESS`;
- auth/profile/wallet/shop/wheel/achievements/QR requests returned 200.

## Deploy order

1. Run the VK parity/release gates.
2. Verify Selectel:
   - `https://139.100.238.159.nip.io/healthz`
   - `https://139.100.238.159.nip.io/readyz`
3. Deploy DEV VK Hosting first.
4. Verify DEV CORS from the exact stage origin.
5. For production use the manual `VK native hosting PRODUCTION deploy` workflow.
6. The production deploy must wait for VK Hosting propagation because a new `pages-ac` URL can return transient 403 immediately after a successful upload.
7. Verify the exact production origin against Selectel CORS before declaring success.
8. Confirm a real VK client reaches `VK_BOOT_COMPLETE` and `VK_PROFILE_SUCCESS`.

## Selectel gateway update

Gateway source lives in `vk-api-gateway/`.

The rollback-safe one-shot hotfix is:

`vk-api-gateway/apply-pages-ac-hotfix.sh`

It backs up `server.mjs`, rebuilds only the gateway container, checks health/readiness and validates production CORS. On verification failure it restores the previous file.

## Railway

Railway is still required for the backend and PostgreSQL in the current architecture.
The no-VPN fix removes Railway from the browser path; it does not remove Railway from the server-side backend path.

If Railway is stopped, VK Hosting can still serve static files but auth/profile/wallet/QR/API operations will fail through the gateway.

## Rollback

If a new VK Hosting build is bad:

- do not roll back the database;
- restore the previous known-good VK Hosting deployment or launch configuration;
- keep the Selectel gateway and backend unchanged unless the fault is proven there;
- re-run the production probe before reopening traffic.
