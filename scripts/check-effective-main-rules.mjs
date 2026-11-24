#!/usr/bin/env node
// REL-01: read-only, fail-closed check of GitHub's *effective* rules on main.
// Never infer protection from a ruleset's name or repository settings alone.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REPO = 'GrafTrahula666/pivnik-bonus-app';
const BRANCH = 'main';
const REQUIRED_CHECK = 'Syntax, tests and dependency audit';

export function evaluateEffectiveRules(rules) {
  if (!Array.isArray(rules)) return { ok: false, reasons: ['Effective rules response is not an array'] };
  const reasons = [];
  const reviews = rules.filter((rule) => rule?.type === 'pull_request');
  const reviewCount = Math.max(0, ...reviews.map((rule) =>
    Number(rule?.parameters?.required_approving_review_count) || 0));
  if (reviewCount < 1) reasons.push('No effective rule requiring an approving review');

  const checks = rules.filter((rule) => rule?.type === 'required_status_checks');
  const contexts = checks.flatMap((rule) => Array.isArray(rule?.parameters?.required_status_checks)
    ? rule.parameters.required_status_checks.map((check) => check?.context)
    : []);
  if (!contexts.includes(REQUIRED_CHECK)) {
    reasons.push('Release gate job is not an effective required status check');
  }
  // Without strict checks, GitHub may accept a green check from an outdated branch tip.
  // An exact-SHA release gate must be revalidated against current main before merge.
  if (!checks.some((rule) => rule?.parameters?.strict_required_status_checks_policy === true &&
    rule.parameters.required_status_checks?.some((check) => check?.context === REQUIRED_CHECK))) {
    reasons.push('Release gate is not protected by strict up-to-date status checks');
  }
  if (!rules.some((rule) => rule?.type === 'deletion')) {
    reasons.push('No effective branch deletion protection');
  }
  return { ok: reasons.length === 0, reasons, reviewCount, contexts };
}

export async function fetchEffectiveRules(token, fetchImpl = fetch) {
  if (!token) throw new Error('GITHUB_TOKEN required; refusing anonymous/inconclusive check');
  const url = `https://api.github.com/repos/${REPO}/rules/branches/${BRANCH}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub effective rules request failed: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const file = process.argv[2];
  const rules = file && file !== '--live'
    ? JSON.parse(await readFile(file, 'utf8'))
    : await fetchEffectiveRules(process.env.GITHUB_TOKEN);
  const result = evaluateEffectiveRules(rules);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`REL-01 effective rules preflight failed closed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
