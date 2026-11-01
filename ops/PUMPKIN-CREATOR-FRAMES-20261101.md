# Two avatar frames: Halloween pumpkins and private CREATOR

Source: selected, narrowed implementation from draft PR #321.
Base: origin/main `febca6ae6ce7be85a53eaf0e4a38fe1f087385ff`. This branch is independent of PR #321.

| Code | Appearance | Access |
| --- | --- | --- |
| `halloween-pumpkin` | Five wicked pumpkins rotating around the avatar | Can be granted to a guest in existing Business CRM |
| `creator-violet` | Violet glass, stationary CREATOR plaque and a separate orbiting half-circle diamond dragon | Only the configured owner Telegram ID or DB-verified VK ID |

Only `assets/frames/halloween-pumpkin.png`, `creator-violet-base.png`,
and `creator-diamond-dragon.png` are imported. Frames for first, second and
third places are intentionally not included in this branch, gift catalog or UI.

## Use

A Business operator may grant the pumpkin from the existing customer card,
«Достижения и рамки» → «Выдать рамку». It remains selectable after a change.
The private CREATOR frame appears in the owner's profile options when their
identity is configured and verified; it cannot be given to arbitrary accounts
via the Business grant/revoke endpoint. The owner can select it manually.
No existing selected frame is overwritten in the database.

The avatar art and CREATOR plaque remain stationary; the diamond dragon is
a distinct rotating visual layer. Motion is disabled for reduced-motion users.

## Release boundary

This branch does not change raffle outcomes, top-three rewards, balances,
bonuses, migrations, kiosk, secrets, runtime patch scripts, distribution,
or production configuration. No automatic grant or rollout is performed.
Tests to validate on this branch: double materialize/idempotency,
`node --test`, `npm run check`, VK parity and bundle tests,
both npm audits and mobile visual tests. These must be reported as run
only when actual CI or local results are available.
