#!/usr/bin/env node
// REL-01: read-only, fail-closed check of GitHub's *effective* rules on main.
// Never infer protection from a ruleset's name or repository settings alone.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPO = 'GrafTrahula666/pivnik-bonus-app';
const BRANCH = 'main';
const REQUIRED_CHECK = 'Syntax, tests and dependency audit';
// Verified check-run app.id for GitHub Actions, not an installation ID.
const REQUIRED_CHECK_INTEGRATION_ID = 15368;
const isTrustedReleaseCheck = (check) => check?.context === REQUIRED_CHECK &&
  check.integration_id === REQUIRED_CHECK_INTEGRATION_ID;

export function evaluateEffectiveRules(rules) {
  if (!Array.isArray(rules)) return { ok: false, reasons: ['Effective rules response is not an array'] };
  const reasons = [];
  const reviews = rules.filter((rule) => rule?.type === 'pull_request');
  const reviewCount = Math.max(0, ...reviews.map((rule) =>
    Number(rule?.parameters?.required_approving_review_count) || 0));
  if (reviewCount < 1) reasons.push('No effective rule requiring an approving review');
  // Require an approving-review rule that also invalidates stale approvals.
  // A different rule with zero required approvals is not sufficient evidence.
  if (!reviews.some((rule) =>
    Number.isInteger(rule?.parameters?.required_approving_review_count) &&
    rule.parameters.required_approving_review_count >= 1 &&
    rule.parameters.dismiss_stale_reviews_on_push === true)) {
    reasons.push('No effective approving-review rule dismisses stale approvals on push');
  }

  const checks = rules.filter((rule) => rule?.type === 'required_status_checks');
  const contexts = checks.flatMap((rule) => Array.isArray(rule?.parameters?.required_status_checks)
    ? rule.parameters.required_status_checks.map((check) => check?.context)
    : []);
  if (!contexts.includes(REQUIRED_CHECK)) {
    reasons.push('Release gate job is not an effective required status check');
  }
  if (!checks.some((rule) => Array.isArray(rule?.parameters?.required_status_checks) &&
    rule.parameters.required_status_checks.some(isTrustedReleaseCheck))) {
    reasons.push('Release gate required check is not bound to GitHub Actions integration 15368');
  }
  // Without strict checks, GitHub may accept a green check from an outdated branch tip.
  // An exact-SHA release gate must be revalidated against current main before merge.
  if (!checks.some((rule) => rule?.parameters?.strict_required_status_checks_policy === true &&
    Array.isArray(rule.parameters.required_status_checks) &&
    rule.parameters.required_status_checks.some(isTrustedReleaseCheck))) {
    reasons.push('Release gate is not protected by strict up-to-date status checks');
  }
  if (!rules.some((rule) => rule?.type === 'deletion')) {
    reasons.push('No effective branch deletion protection');
  }
  if (!rules.some((rule) => rule?.type === 'non_fast_forward')) {
    reasons.push('No effective non-fast-forward (force-push) protection');
  }
  return { ok: reasons.length === 0, reasons, reviewCount, contexts };
}

async function githubRulesGet(token, url, fetchImpl) {
  if (!token) throw new Error('GITHUB_TOKEN required; refusing anonymous/inconclusive check');
  const response = await fetchImpl(url, {
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub rules request failed: HTTP ${response.status}`);
  return response.json();
}

export async function fetchEffectiveRules(token, fetchImpl = fetch) {
  const url = `https://api.github.com/repos/${REPO}/rules/branches/${BRANCH}`;
  const rules = [];
  // A truncated first page is not complete evidence of all applicable rulesets.
  for (let page = 1; page <= 20; page++) {
    const batch = await githubRulesGet(token, `${url}?per_page=100&page=${page}`, fetchImpl);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error('Malformed effective rules page');
    rules.push(...batch);
    if (batch.length < 100) return rules;
  }
  throw new Error('Effective rules pagination exceeded safety limit');
}

export async function verifyRulesetBypasses(rules, token, fetchImpl = fetch) {
  if (!Array.isArray(rules) || !rules.length) throw new Error('No effective ruleset provenance');
  const sources = new Map();
  for (const rule of rules) {
    const id = rule?.ruleset_id;
    const type = rule?.ruleset_source_type;
    const source = rule?.ruleset_source;
    if (!Number.isSafeInteger(id) || id <= 0 ||
        !['Repository', 'Organization', 'Enterprise'].includes(type) ||
        typeof source !== 'string' || !source.trim() ||
        (type === 'Repository' && source.toLowerCase() !== REPO.toLowerCase())) {
      throw new Error('Missing or invalid effective ruleset provenance');
    }
    const previous = sources.get(id);
    if (previous && (previous.type !== type || previous.source !== source)) {
      throw new Error('Conflicting effective ruleset provenance');
    }
    sources.set(id, { type, source });
  }
  for (const [id, expected] of sources) {
    const detail = await githubRulesGet(token,
      `https://api.github.com/repos/${REPO}/rulesets/${id}?includes_parents=true`, fetchImpl);
    if (detail?.id !== id || detail.source_type !== expected.type ||
        detail.source !== expected.source || detail.target !== 'branch' ||
        detail.enforcement !== 'active') {
      throw new Error(`Ruleset ${id} identity or active branch enforcement not confirmed`);
    }
    // GitHub omits bypass_actors without write access to the ruleset.
    // Never interpret an omitted field as an empty list or escalate CI privileges.
    if (!Array.isArray(detail.bypass_actors) || detail.bypass_actors.length !== 0) {
      throw new Error(`Ruleset ${id} has bypass actors or their absence is not verifiable`);
    }
  }
  return [...sources.keys()];
}

async function main() {
  const file = process.argv[2];
  const rules = file && file !== '--live'
    ? JSON.parse(await readFile(file, 'utf8'))
    : await fetchEffectiveRules(process.env.GITHUB_TOKEN);
  const result = evaluateEffectiveRules(rules);
  const live = !file || file === '--live';
  // A fixture only checks rule structure; it cannot prove live bypass policy.
  result.bypassEvidence = 'not-verified';
  if (live && result.ok) {
    result.verifiedRulesetIds = await verifyRulesetBypasses(rules, process.env.GITHUB_TOKEN);
    result.bypassEvidence = 'verified-empty';
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`REL-01 effective rules preflight failed closed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
