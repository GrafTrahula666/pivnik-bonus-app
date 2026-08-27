import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
const MARKER = '// RED_COSMOS_V2_PENDING_TESTER_CLAIMS';
let source = await fs.readFile(gatewayPath, 'utf8');

if (!source.includes(MARKER)) {
  const authAnchor = 'async function authenticateVk(body) {';
  if (!source.includes(authAnchor)) throw new Error('RED COSMOS tester claims: auth anchor missing');
  const helper = `async function claimPendingSpecialAchievement(userId, provider, externalUser) {
  const result = await pool.query(
    'SELECT * FROM pivnik_claim_pending_special_achievement($1::bigint,$2::text,$3::text,$4::text)',
    [userId, provider, String(externalUser?.id || ''), externalUser?.username || null]
  );
  const claim = result.rows[0] || null;
  if (claim?.claimed) {
    console.log(JSON.stringify({
      specialAchievementClaimed: true,
      handle: claim.recipient_handle,
      awardedBonus: Number(claim.awarded_bonus || 0),
      userId: String(userId)
    }));
  }
  return claim;
}

`;
  source = source.replace(authAnchor, helper + authAnchor);

  const tokenAnchor = `  const token = createSession(
    userId,
    provider,
    Number(sessionResult.rows[0]?.session_version || 1),
    { pid: String(externalUser.id) }
  );
  setImmediate(() => {`;
  const tokenReplacement = `  const token = createSession(
    userId,
    provider,
    Number(sessionResult.rows[0]?.session_version || 1),
    { pid: String(externalUser.id) }
  );
  await claimPendingSpecialAchievement(userId, provider, externalUser);
  setImmediate(() => {`;
  if (!source.includes(tokenAnchor)) throw new Error('RED COSMOS tester claims: resolveProviderUser token anchor missing');
  source = source.replace(tokenAnchor, tokenReplacement);
  source += `\n${MARKER}\n`;
}

for (const token of [
  'claimPendingSpecialAchievement(userId, provider, externalUser)',
  'pivnik_claim_pending_special_achievement',
  MARKER
]) {
  if (!source.includes(token)) throw new Error(`RED COSMOS tester claims verification missing: ${token}`);
}

await fs.writeFile(gatewayPath, source, 'utf8');
console.log('RED COSMOS pending tester achievement claims wired to authenticated VK/TG login.');
