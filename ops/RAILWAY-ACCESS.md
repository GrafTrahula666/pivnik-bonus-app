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


## Operator environment policy readback (read-only, no credential provisioning)

Complement [the ruleset readback](release-evidence/OPERATOR-RULESET-READBACK.md)
with the environment-specific observation below. A protected branch alone
does not restrict an environment secret to that branch. Use a separately
authorized human operator session on a trusted workstation, not CI or
unreviewed Draft code. Confirm the account with `gh auth status --hostname github.com`.
The documented [environment GET](https://docs.github.com/en/rest/deployments/environments)
and [branch-policy list GET](https://docs.github.com/en/rest/deployments/branch-policies)
are the only environment calls in this procedure.

Copy the reviewed block to a private file outside the checkout; invoke with the
separately agreed full main SHA. Bash, jq and a trusted GitHub CLI with
`--paginate --slurp` support are required. No shell tracing or token printing.

```bash
set -euo pipefail
umask 077
repo=GrafTrahula666/pivnik-bonus-app
envname=railway-ci-read-diagnostic
expected=${1:?Supply independently reviewed main SHA}
[[ "$expected" =~ ^[0-9a-f]{40}$ ]]
work=$(mktemp -d)
printf 'Private evidence directory: %s\n' "$work" >&2
api() { gh api --hostname github.com --method GET "$@"; }
check_main() {
  api "repos/$repo/git/ref/heads/main" | jq -e --arg sha "$expected" \
    '.ref == "refs/heads/main" and .object.type == "commit" and .object.sha == $sha' >/dev/null
}
sweep() {
  local dir="$1"
  mkdir "$dir"
  check_main
  api "repos/$repo/environments/$envname" | jq -eS '
    select(.name == "railway-ci-read-diagnostic" and
      .deployment_branch_policy.protected_branches == false and
      .deployment_branch_policy.custom_branch_policies == true and
      ([.protection_rules[] | select(.type == "required_reviewers")] | length == 1) and
      ([.protection_rules[] | select(.type == "required_reviewers")][0] |
        .prevent_self_review == true and (.reviewers | type == "array" and length > 0 and
          all(.[]; (.type == "User" or .type == "Team") and
            (.reviewer.id | type == "number" and . > 0 and floor == .)))))
    | {id,name,updated_at,deployment_branch_policy,protection_rules}' > "$dir/environment.json"
  api --paginate --slurp "repos/$repo/environments/$envname/deployment-branch-policies?per_page=100" | jq -eS '
    select(type == "array" and length > 0 and
      all(.[]; .total_count == 1 and (.branch_policies | type == "array")))
    | map(.branch_policies) | add
    | select(length == 1 and .[0].name == "main" and .[0].type == "branch")' > "$dir/branch-policies.json"
  check_main
}
sweep "$work/first"
sweep "$work/second"
diff -qr "$work/first" "$work/second"
check_main
printf '%s\n' "$expected" > "$work/main.sha"
date -u +%Y-%m-%dT%H:%M:%SZ > "$work/observed-at.utc"
(cd "$work" && sha256sum main.sha observed-at.utc second/* > SHA256SUMS && sha256sum -c SHA256SUMS)
printf 'Partial environment observation only; manual checks remain: %s\n' "$work"
```

Nonzero exit, missing fields (including a missing branch/tag type), extra policies,
or an incomplete response is not a pass. Keep partial files private. A tag
named main is not the main branch. The API predicates alone do not prove
reviewer independence or absence of administrator bypass. The two observations
are not atomic and do not establish future policy stability.

Before adding any credential, the owner and independent reviewer must also
inspect the actual environment Settings UI, confirm administrator bypass is
disabled (do not infer this from a missing REST field), verify the reviewers'
identity, eligibility and independence, and confirm there is no repository-
or organization-scoped secret with the same name available to this repository.
Check names/visibility only, never secret values. Save restricted, redacted
evidence of those settings and the readback hashes, then perform the no-secret
negative branch/tag and positive independent-approval trials described above
in a separate safe test context. No credential is to be provisioned by this
procedure. If a required feature or readback is unavailable, stop.

Record the exact SHA, environment ID, observation time, hashes and independent
review result in #483; do not publish raw reviewer records, tokens or secret
values. A successful collection is a partial operator observation, not a
release approval or a substitute for the live release gate. Recollect after
any policy or SHA change. No workflow dispatch, environment mutation, secret
write, Railway mutation or release is performed by this procedure.

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
