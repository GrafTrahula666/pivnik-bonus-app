# REL-01 · Operator-controlled ruleset readback (Draft)

## Scope and trust boundary

GitHub's [effective branch rules](https://docs.github.com/en/rest/repos/rules#get-rules-for-a-branch) and [ruleset details](https://docs.github.com/en/rest/repos/rules#get-a-repository-ruleset) are distinct. The latter can omit `bypass_actors` when the caller lacks ruleset write access. A production job with `contents: read` must not be given an administrative credential to work around that limitation. Do not replace its failed live preflight with a user-provided JSON file, digest, comment or environment variable.

This procedure gathers independently inspectable observations for one already agreed exact `main` SHA. It does not change rulesets, enable a workflow, approve a release or publish anything. No CI consumes its output. The live preflight remains fail closed. Issue [#483](https://github.com/GrafTrahula666/pivnik-bonus-app/issues/483) remains open until the actual settings and staging negative/positive tests are proven.

## Operator readback

Use a separate trusted operator workstation, an existing authorized human GitHub session with visibility of bypass lists for all applicable rulesets, trusted GitHub CLI (with `--paginate --slurp` support), Bash, jq 1.6+ and GNU coreutils. Do not install credentials on CI, run unreviewed repository code with this session, use shell tracing, or paste credentials in logs. Confirm the account and host with `gh auth status --hostname github.com`. Review the commands below independently; copy them into a private local script outside the repository, rather than executing a script from a draft checkout. The argument is the separately agreed full main SHA, not a branch or draft PR head. All network operations below are GET.

```bash
set -euo pipefail
umask 077
repo=GrafTrahula666/pivnik-bonus-app
expected=${1:?Supply the independently approved full main SHA}
[[ "$expected" =~ ^[0-9a-f]{40}$ ]]
work=$(mktemp -d)
printf 'Private evidence directory: %s\n' "$work" >&2
api() { gh api --hostname github.com --method GET "$@"; }
check_main() {
  api "repos/$repo/git/ref/heads/main" | jq -e --arg sha "$expected" \
    '.ref == "refs/heads/main" and .object.type == "commit" and .object.sha == $sha' >/dev/null
}
api user | jq -eS 'select(.type == "User" and (.id | type == "number") and (.login | type == "string")) | {id,login,type}' > "$work/operator.json"
sweep() {
  local dir="$1" id source kind
  mkdir "$dir"
  check_main
  api --paginate --slurp "repos/$repo/rules/branches/main?per_page=100" | jq -eS '
    select(type == "array" and length > 0 and length <= 20 and all(.[]; type == "array" and length <= 100))
    | add | select(length > 0 and all(.[];
        (.ruleset_id | type == "number" and . > 0 and . <= 9007199254740991 and floor == .) and
        (.ruleset_source_type | IN("Repository", "Organization", "Enterprise")) and
        (.ruleset_source | type == "string" and length > 0))) | sort' > "$dir/effective.json"
  jq -e --arg repo "$repo" '
    group_by(.ruleset_id) | all(.[];
      (map([.ruleset_source_type,.ruleset_source]) | unique | length == 1) and
      (.[0] | .ruleset_source_type != "Repository" or (.ruleset_source | ascii_downcase) == ($repo | ascii_downcase)))' "$dir/effective.json" >/dev/null
  jq -r 'map(.ruleset_id) | unique[]' "$dir/effective.json" > "$dir/ids.txt"
  while IFS= read -r id; do
    source=$(jq -er --argjson id "$id" 'first(.[] | select(.ruleset_id == $id) | .ruleset_source)' "$dir/effective.json")
    kind=$(jq -er --argjson id "$id" 'first(.[] | select(.ruleset_id == $id) | .ruleset_source_type)' "$dir/effective.json")
    api "repos/$repo/rulesets/$id?includes_parents=true" | jq -eS --argjson id "$id" --arg source "$source" --arg kind "$kind" '
      select(.id == $id and .source == $source and .source_type == $kind and .target == "branch" and .enforcement == "active" and
             (.bypass_actors | type == "array" and length == 0))
      | {id,source,source_type,target,enforcement,bypass_actors,conditions,rules,updated_at}' > "$dir/ruleset-$id.json"
  done < "$dir/ids.txt"
  check_main
}
sweep "$work/first"
sweep "$work/second"
diff -qr "$work/first" "$work/second"
check_main
printf '%s\n' "$expected" > "$work/main.sha"
date -u +%Y-%m-%dT%H:%M:%SZ > "$work/observed-at.utc"
(cd "$work" && sha256sum main.sha observed-at.utc operator.json second/* > SHA256SUMS && sha256sum -c SHA256SUMS)
printf 'Readback collected; not release approval: %s\n' "$work"
```

Invoke the reviewed local copy as `bash readback.sh <approved-full-main-sha>`. A nonzero exit or missing `SHA256SUMS` means collection failed; retain partial output privately for diagnosis and never present it as a completed observation. The two sweeps include every page returned by GitHub and every distinct contributing ruleset, including inherited ones; they require explicit empty bypass lists and unchanged observed policy and main SHA. The hashes protect the recorded bytes against accidental modification, not against a dishonest author. The sweeps are not atomic, and a policy change after the final read (or a change and reversion between reads) cannot be ruled out.

## Independent review and handoff

1. On a separate unprivileged machine with no operator session or credentials, review the candidate validator source at its exact GitHub commit and run `node scripts/check-effective-main-rules.mjs /path/to/second/effective.json` from that reviewed copy. Require exit 0 and review the reported policy; fixture mode deliberately reports `bypassEvidence=not-verified`. A successful readback alone does not prove required approvals, trusted strict checks or deletion/force-push protection.
2. The authorized operator and an independent reviewer compare both sweeps, verify `SHA256SUMS`, and verify the actual GitHub settings, including inherited rulesets and any other release path. The operator posts an authenticated comment in #483 with exact main SHA, UTC observation time, observed ruleset IDs, SHA-256 of `SHA256SUMS`, validator revision and result, and a restricted evidence location. Do not post tokens, unrelated private policy data or raw failed responses. The independent reviewer must read the original evidence and confirm operator authority separately; a comment or digest alone is not authorization.
3. Any change to main, applicable policy, operator authority or release candidate invalidates this observation. Recollect immediately before a separately authorized release while the operator controls a deployment freeze. Staging must demonstrate rejection of unapproved/red SHA and acceptance of the approved green SHA, separately for Railway and VK. Do not test with a deliberately bad commit in production.
4. Keep the current live validator strict until an independently reviewed, trusted and freshness-bound mechanism is designed for the CI/operator boundary. Never trust a PR-authored artifact or self-attestation as a substitute for live enforcement. The existing production CI permissions, Railway settings, release approval, rollback and smoke requirements stay unchanged.

## Evidence status

Collection logic has synthetic shell checks only; no authenticated operator collection or staging rehearsal has been performed. This runbook is an operational prerequisite, not proof of effective protection, not an approval, and not a release unlock.
