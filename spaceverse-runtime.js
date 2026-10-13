// Deliberate code-level rollout gate. Neither startup nor a request can enable it.
// Migrations 009/010, approved attribution and legacy-auth migration are separate
// operator/release decisions; changing this constant is NOT part of this PR.
export const SPACEVERSE_RUNTIME = Object.freeze({ scopedModeEnabled: false });
