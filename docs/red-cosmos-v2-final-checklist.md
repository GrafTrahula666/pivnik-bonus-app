# PIVNIK RED COSMOS v2.0 — final release gate

This branch is intentionally based on the current working production `main` after the VK interaction hotfix.

## Must be true before merge

- VK document loads `red-cosmos-v2.css` and `red-cosmos-v2.js`, not the obsolete v22 UI layer.
- Bottom navigation has five tappable controls in VK.
- QR, shop, achievements, profile/settings and wheel controls have interaction fallback coverage.
- Wheel backend accepts both `telegram` and `vk` while preserving one shared user cooldown/account state.
- Client shop exposes exactly four purchasable frame products with local SVG artwork.
- Previous shop rows remain in the database for audit but are not returned in the client catalog.
- Frame purchase is idempotent, writes one completed transaction, deducts once, and persists ownership.
- Existing selected/legacy frames are copied into `user_frames` without deleting legacy grants.
- Achievement UI uses deterministic server progress; locked cards are grey and earned cards are gold.
- `raise-shields` remains a special award outside the countable achievement catalog.
- Creator/beta/reward grants are preserved; no balance reset or destructive user migration is allowed.
- League rows include VK/Telegram platform labels.
- VK QR copy contains no permanent/reusable-code wording.
- Back controls are large, labeled `Назад`, participate in layout, and do not cover content.
- Admin is split into eight compact sections.
- Production prestart creates/verifies `pivnik_red_cosmos_v2_preupgrade_20260827` before applying additive migration 007.
- CI materialization, syntax, tests and dependency audit must all be green.

No production data repair is allowed to guess user identities. Special tester repair must resolve each requested handle to exactly one active account or remain pending/read-only.
