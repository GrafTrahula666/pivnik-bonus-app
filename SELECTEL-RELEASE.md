# Selectel Evotor ingress release, 2026-10-16

Status: installer prepared and locally tested. Production installation and physical Evotor acceptance are NOT complete.

This is a separately reviewed gateway branch, not main. Installing it changes the live Caddy route and starts a bounded sidecar; an incorrect live configuration can disrupt ingress. The installer rejects unknown configuration, saves the exact original files and restores the prior route when post-installation checks fail. Main application code, the VK gateway implementation, the existing Compose file, credentials and databases are unchanged. This branch has no application CI workflow; the attached local checks are not production or hardware acceptance.

## Confirmed prerequisites

The owner's actual VM console showed the three expected installed file SHA-256 values. VM-origin requests to main Railway health and the existing Vercel relay both returned HTTP 200. The main probe was 2026-10-16T16:39:04Z, production release 2ac9ed5022b0e0416775404da370a165d7bccba0. These observations are time-specific; the installer verifies fresh connectivity again.

## Transaction

Run install-selectel.py with Python3 as root on the existing pivnik-vk-gateway VM. It verifies host, local Docker, actual containers/mount/network/domain, installed file hashes, free resources and current main/VK responses. Source is fixed at d396226d8876e46b50c8fb217e79287be833a337 with four embedded SHA-256 hashes and a digest-pinned Node base.

It starts only the new no-secret, read-only, capability-free sidecar with resource/log limits on the existing network, with no published host port. Its actual Node TLS upstream is verified before modifying ingress. A new /evotor prefix is added to the existing Caddy site; old VK rules remain. The Caddyfile is written in place to preserve the existing bind-mount inode and gracefully reloaded without restarting VK containers. Public health identity, exact unauthorized POS replies, VK health/readiness/static/CORS/origin guard and unchanged container start times are required for success.

Exact original Caddy/Compose backups, installer copy, transaction state and a rollback command are stored in a new private /opt/pivnik-evotor-release-* directory. Manual rollback refuses to overwrite a later operator's unrelated configuration. No bootstrap script, reboot, password reset, environment change, migration, wallet write or APK installation is performed.

## Checks and limits

- 14/14 actual local Caddy/VK/entry routing checks passed.
- 9/9 installer transaction checks passed against real disposable Caddy/VK/entry containers: source integrity rejection, full success, bind-mount inode, unchanged Compose, concurrent-edit refusal, manual rollback, sidecar ownership, automatic rollback, no old-service restart.
- Installer fixture substitutes external source download and the already verified image build; its upstream is a local TLS fixture. It does not prove production networking.
- Python syntax and exact localized/code POS refusal compatibility passed; arbitrary proxy HTTP401 responses are rejected.
- Physical till, Evotor allowed URLs, compatible APK/key migration, saved key, real scanning, accrual and redemption are not yet accepted.
- No changes to canonical application modules, money, database or patch chain; main ops/MODULE-MAP.md is therefore not modified by this standalone gateway release.
