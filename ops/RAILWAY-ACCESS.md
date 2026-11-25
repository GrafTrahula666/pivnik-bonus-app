# Railway access for automated release

GitHub repository access and Railway account access are separate. The Railway GitHub App can deploy repository commits, but it does not expose service variables or database credentials to GitHub Actions.


## REL-02: protected operator diagnosis (candidate, not provisioned)

The new diagnostic job must not be dispatched from a Draft or run against a live
credential until its exact workflow SHA has been independently reviewed and
REL-01 controls are verified. The GitHub environment is
`railway-ci-read-diagnostic`. Its name in YAML does not create any security
guarantee; GitHub can auto-create an environment without protection rules.

Owner-only setup, after review and separate authorization:

1. In Settings → Environments configure that environment explicitly. Allow only
   the **branch** `main` (not tags, wildcard branches, or all protected branches).
   Require an independent reviewer, prevent self-review and disallow admin
   bypass where supported. If those controls are unavailable on the repository
   plan, stop; do not provision the credential.
2. Verify effective protection of main and actual environment rules via
   readback, not just a ruleset name or a green workflow. An unprotected-main
   diagnostic dispatch is deliberately rejected without credentials.
3. Only then add `RAILWAY_OPERATOR_READ_TOKEN` **as an environment secret**.
   Never define that name at repository or organization scope; otherwise another
   workflow could reference it without the environment. Use the owner-verified
   least-privilege Railway read credential for the exact production project and
   environment. The diagnostic makes only queries; this alone does not prove
   the underlying token cannot mutate. Do not add a deployment credential.
4. Verify a non-main diagnostic dispatch is rejected without reaching the
   credential step using a synthetic/no-secret trial. Separately verify that
   the environment policy itself rejects non-main jobs even if the workflow's
   own conditional is changed. Do not perform this experiment with live secrets.
5. After independent approval, manually select the reviewed main SHA and
   diagnose mode. Capture dispatch/run/attempt, actual checkout SHA, environment
   approval, and diagnostic step output/exit status. A skipped job or a green
   discovery job is not diagnosis evidence. The diagnostic queries both target
   services, prints only status fields, and never deploys.

The legacy discover mode stays separate and does not receive the operator
credential. The release gate still has its separate
`RAILWAY_PRODUCTION_READ_TOKEN` binding; a diagnosis with a different token
does not establish that the release gate credential works. No secret placement,
rotation, environment configuration, live query, or release is authorized by
this candidate. The following older setup and release description is historical;
it is not authorization to change credentials, migrate production data or deploy.

## One-time setup

1. In Railway click the profile photo in the top-right corner.
2. Open **Account Settings → Tokens**.
3. Create a token and select the workspace that contains the production projects `pivnik-bonus-app` and `pivnik-vk-test`. Do not choose **No workspace**: a token without workspace access returns an empty project list.
4. In GitHub open this repository → **Settings → Secrets and variables → Actions**.
5. Open the existing repository secret `RAILWAY_API_TOKEN` and replace its value with the new token.
6. Do not put the token in source code, issues, pull requests, screenshots or chat messages.

## What happens next

Run GitHub Actions workflow **Pivnik Railway operator**. It calls `npm run railway:discover` and safely returns only project, environment and service IDs/names. It does not print variables, database URLs or other secrets.

After discovery the release process can automate:

- backup of both production databases;
- audit of the Telegram and VK datasets;
- migration of VK records into the canonical Telegram database;
- assignment of the common database reference to both services;
- creation of a stable `IDENTITY_TOMBSTONE_SECRET`;
- deployment and `/api/release-readiness` verification;
- rollback if the deployed gate fails.
