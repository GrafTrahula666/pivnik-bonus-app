# Animated rewards and private CREATOR

Base: origin/main `febca6ae6ce7be85a53eaf0e4a38fe1f087385ff`.
Branch: `feat/reward-creator-frames-20261030`.

| Code | Appearance | Availability |
| --- | --- | --- |
| halloween-pumpkin | Five wicked pumpkins, rotating ring | Existing Business frame grant |
| infernal-warden | III, dark metal, ember pulse and sparks | Existing Business frame grant |
| frost-tyrant | II, platinum dragons, cold light and crystals | Existing Business frame grant |
| eclipse-sovereign | I, gold dragons, ruby crown, glints | Existing Business frame grant |
| creator-violet | Purple glass, fixed CREATOR plaque, orbiting diamond dragon | Configured Telegram/VK owner identities only |

The six original generated transparent PNG assets are in `assets/frames`.
The creator dragon is a separate half-circle sprite, with an 18-second orbit.
The base and plaque stay fixed, in front of the passing dragon. Prize art
stays fixed while masked light and small particles animate. Reduced-motion
disables all new animation. There are no generated portraits or new tracking.

## Issuance and selection

Use the existing linked PIVNIK Business customer rewards panel and its
"Выдать рамку" action. The four prizes are added to the runtime catalog;
the existing protected internal API persists them in `user_frames`. The guest
then selects an earned frame in their profile. Existing duplicate-grant and
Business-only revocation semantics remain. CREATOR is not in this grant list;
it is available only to the configured creator identities in Telegram/VK, even when another
account has the admin role. No startup script grants frames or changes a
guest's selection. Owner startup/auth repair preserves newly selected frames.

The Halloween Live raffle (#318) is not changed and does not automatically
distribute these prizes. This feature does not apply production data changes.

## Validation and release boundary

- Baseline materialized full suite: 658/658 passed; check passed.
- Candidate full suite: 661/661 passed, 0 skipped; includes real handler SQL
  grant/revoke, duplicate rejection, recipient selection, CREATOR isolation,
  owner restart/auth preservation, and renderer/asset checks.
- Materialize twice: SHA-256 equality, excluding only the timestamp stamp as
  in release-gate.yml. The existing real-frame-preview patch anchor is kept
  intact; its live preview automatically uses the extended avatar renderer.
- Syntax checks, VK startup parity, VK bundle with the configured production
  gateway, and npm pack --dry-run passed. Existing VK builder copies all assets.
- Full npm audit: exit 1, one pre-existing moderate qs advisory,
  GHSA-6pq8-jhm2-2vcw. Recorded separately in #320. Production audit at the
  high threshold: exit 0, same moderate advisory. No dependency changes;
  package-lock.json blob remains `8ec13db3b999bca7f783d05071359858043ceb6d`.
- Browser visual acceptance is NOT completed: local Chromium fails before
  opening a page (socket operation denied); computer-use browser also fails
  to initialize. Source/DOM/SQL checks do not substitute for that acceptance.

Before production release: resolve the dependency gate separately and review
the creator/prize appearance at mobile sizes, checking all four orbit phases,
legible CREATOR, unchanged portrait, no balance clipping, reduced motion,
profile selection after a new TG/VK login, and Business issuance/revocation.
No production deployment, migration, reward distribution, kiosk update or
financial-path change is included in this branch. Existing auth/role rules,
legacy special-person frame priorities and patch-chain scripts are retained.
