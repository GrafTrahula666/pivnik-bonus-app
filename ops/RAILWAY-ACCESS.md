# Railway access for automated release

GitHub repository access and Railway account access are separate. The Railway GitHub App can deploy repository commits, but it does not expose service variables or database credentials to GitHub Actions.

## One-time setup

1. In Railway click the profile photo in the top-right corner.
2. Open **Account Settings → Tokens**.
3. Create a token and choose **No workspace** so it is an account token.
4. In GitHub open this repository → **Settings → Secrets and variables → Actions**.
5. Create repository secret named exactly `RAILWAY_API_TOKEN`.
6. Paste the token value there. Do not put it in source code, issues, pull requests, screenshots or chat messages.

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
