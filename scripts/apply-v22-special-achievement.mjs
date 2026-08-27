import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'PIVNIK_V22_SPECIAL_ACHIEVEMENT_20260827';

async function read(file) {
  return fs.readFile(path.join(root, file), 'utf8');
}

async function write(file, content) {
  await fs.writeFile(path.join(root, file), content, 'utf8');
}

function addSpecialAchievement(source, label) {
  if (source.includes(`// ${MARKER}:${label}`)) return source;

  const fnPattern = /function achievementsFromRow\(row\) \{[\s\S]*?\n  return achievements;\n\}/;
  const match = source.match(fnPattern);
  if (!match) throw new Error(`v22 special: achievementsFromRow not found in ${label}`);
  if (match[0].includes("code: 'raise-shields'")) return `${source}\n// ${MARKER}:${label}\n`;

  const patchedFn = match[0].replace(
    '  return achievements;',
    `  if (row?.has_raise_shields) {
    achievements.push({
      code: 'raise-shields',
      title: 'Поднять щиты',
      rarity: 'legendary',
      description: 'Особая легендарная награда трём лучшим тестировщикам «Пивника».',
      icon: 'shield',
      rewardBonus: 750,
      grantedAt: row.raise_shields_granted_at || null,
      announced: true
    });
  }
  return achievements;`
  );
  return `${source.replace(match[0], patchedFn)}\n// ${MARKER}:${label}\n`;
}

async function patchAchievements() {
  let source = await read('achievements.js');

  source = source.replace(
    /,\n  \{\n    code: 'raise-shields',[\s\S]*?\n    manualOnly: true\n  \}\n\];/,
    '\n];'
  );
  source = source.replace(/\n\s*raiseShieldsGranted: 0,?/, '');
  source = source.replace(/\n\s*if \(definition\.manualOnly\) continue;/, '');

  if (source.includes("code: 'raise-shields'")) {
    throw new Error('v22 special: raise-shields must not remain in countable catalog');
  }
  await write('achievements.js', source);
}

async function patchServer() {
  let source = await read('server.js');
  source = addSpecialAchievement(source, 'server');

  if (!source.includes('has_raise_shields = Boolean(raiseShieldsResult')) {
    const from = `  const row = userResult.rows[0];
  const [spend12mCents, achievementState] = await Promise.all([
    getRollingSpend(db, userId),
    getUserEarnedAchievementState(db, userId)
  ]);`;
    const to = `  const row = userResult.rows[0];
  const [spend12mCents, achievementState, raiseShieldsResult] = await Promise.all([
    getRollingSpend(db, userId),
    getUserEarnedAchievementState(db, userId),
    db.query(
      \`SELECT created_at
       FROM reward_grants
       WHERE user_id = $1::bigint
         AND source = 'achievement'
         AND achievement_code = 'raise-shields'
       ORDER BY created_at ASC
       LIMIT 1\`,
      [userId]
    )
  ]);
  row.has_raise_shields = Boolean(raiseShieldsResult.rowCount);
  row.raise_shields_granted_at = raiseShieldsResult.rows[0]?.created_at || null;`;
    if (!source.includes(from)) throw new Error('v22 special: server getProfile block not found');
    source = source.replace(from, to);
  }
  await write('server.js', source);
}

async function patchGateway() {
  let source = await read('universal-server.js');
  source = addSpecialAchievement(source, 'gateway');

  if (!source.includes('row.has_raise_shields = Boolean(raiseShieldsResult')) {
    const from = `  const row = result.rows[0];
  const [spend12mCents, achievementState, identitySummary] = startup
    ? [
      0,
      { earned: [], unannounced: [] },
      {
        identities: [],
        linkedPlatforms: ['telegram', 'vk'].includes(platform) ? [platform] : [],
        accountLinked: false,
        legacyLinked: false
      }
    ]
    : await Promise.all([
      getRollingSpend(db, canonical),
      getUserEarnedAchievementState(db, canonical),
      getIdentitySummary(db, canonical)
    ]);`;
    const to = `  const row = result.rows[0];
  const [spend12mCents, achievementState, identitySummary, raiseShieldsResult] = startup
    ? [
      0,
      { earned: [], unannounced: [] },
      {
        identities: [],
        linkedPlatforms: ['telegram', 'vk'].includes(platform) ? [platform] : [],
        accountLinked: false,
        legacyLinked: false
      },
      { rowCount: 0, rows: [] }
    ]
    : await Promise.all([
      getRollingSpend(db, canonical),
      getUserEarnedAchievementState(db, canonical),
      getIdentitySummary(db, canonical),
      db.query(
        \`SELECT created_at
         FROM reward_grants
         WHERE user_id = $1::bigint
           AND source = 'achievement'
           AND achievement_code = 'raise-shields'
         ORDER BY created_at ASC
         LIMIT 1\`,
        [canonical]
      )
    ]);
  row.has_raise_shields = Boolean(raiseShieldsResult.rowCount);
  row.raise_shields_granted_at = raiseShieldsResult.rows[0]?.created_at || null;`;
    if (!source.includes(from)) throw new Error('v22 special: gateway getProfile block not found');
    source = source.replace(from, to);
  }
  await write('universal-server.js', source);
}

async function verify() {
  const [achievements, server, gateway] = await Promise.all([
    read('achievements.js'), read('server.js'), read('universal-server.js')
  ]);
  if (achievements.includes("code: 'raise-shields'")) throw new Error('raise-shields leaked into countable catalog');
  for (const [name, source] of [['server', server], ['gateway', gateway]]) {
    if (!source.includes("code: 'raise-shields'")) throw new Error(`${name}: special achievement missing`);
    if (!source.includes("achievement_code = 'raise-shields'")) throw new Error(`${name}: special grant lookup missing`);
  }
}

await patchAchievements();
await patchServer();
await patchGateway();
await verify();
console.log('Pivnik v22 special tester achievement is separated from countable catalog.');
