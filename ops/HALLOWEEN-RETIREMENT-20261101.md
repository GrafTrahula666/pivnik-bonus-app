# Night of Cauldrons: remove live raffle/tickets, preserve financial records

**Scope:** retire the 2026 seasonal lottery and ticket system. Do not change approved customer bonus calculations, point wallet, beer rewards, wheel odds, payment/refund accounting, existing profile frames or kiosk. This is independent of draft frames PR #323.

**Removed from live runtime:** Halloween summary/invite APIs, login invite attribution, buyer ticket grants, first-purchase referral rewards, cancellation/return hooks, conditional wheel ticket replacement, client raffle screen, invite sheet and countdown banner. Seasonal cosmetic theme remains as it is not a ticket mechanism.

**Read-only compatibility:** old 'halloween-ticket' wheel spins are still decoded as an archived prize (never converted to a beer glass in past history). Manual migration 011 and startup migration 015 are historical schema migration evidence and MUST NOT be deleted. Existing DB tickets, draw results and referral ledger are left untouched; nothing calls a destructive migration or resets balances.

**Test change:** only tests whose sole contract is the removed feature are retired. Added regression for no new ticket payouts and no client/server raffle entrypoints. Existing generic wallet, wheel, POS money and server tests continue as mandatory gates. The full suite is not green until CI actually passes.

**Release risk:** a merge into main starts a production deployment through the existing release workflow. Do not merge this draft while checks are pending or red, or without production rollout authorization and rollback checks.
