import pg from 'pg';
import { RAILWAY_PRODUCTION } from './railway-production-config.mjs';
import { findSevTroutTelegramId, grantPersonalTelegramFrames, PERSONAL_FRAME_GIFT_CODE } from '../personal-profile-frames.js';
import { signSession } from '../platform-core.js';

const expected = String(process.env.RELEASE_COMMIT_SHA || '');
const token = String(process.env.RAILWAY_API_TOKEN || '');
if (!/^[a-f0-9]{40}$/.test(expected) || !token) throw new Error('Exact release SHA and Railway API token are required.');

async function variables(serviceId) {
  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `query($projectId:String!,$environmentId:String!,$serviceId:String!) {
      variables(projectId:$projectId,environmentId:$environmentId,serviceId:$serviceId,unrendered:false)
    }`, variables: { projectId: RAILWAY_PRODUCTION.projectId, environmentId: RAILWAY_PRODUCTION.environmentId, serviceId } }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length || !data.data?.variables) throw new Error('Railway credentials lookup failed.');
  return data.data.variables;
}

const [appVars, dbVars] = await Promise.all([
  variables(RAILWAY_PRODUCTION.services.telegram), variables(RAILWAY_PRODUCTION.services.postgres)
]);
if (!dbVars.DATABASE_PUBLIC_URL || !appVars.OWNER_TELEGRAM_ID || !appVars.SESSION_SECRET) {
  throw new Error('Production database connection or owner/session configuration is unavailable.');
}
// Ensure the public connection really points to the application database.
let appDb, publicDb;
try {
  appDb = new URL(appVars.DATABASE_URL);
  publicDb = new URL(dbVars.DATABASE_PUBLIC_URL);
} catch { throw new Error('Production database configuration is invalid.'); }
if (appDb.username !== publicDb.username || appDb.password !== publicDb.password || appDb.pathname !== publicDb.pathname) {
  throw new Error('Public database does not match the Telegram application database.');
}
for (const base of Object.values(RAILWAY_PRODUCTION.urls).slice(0, 2)) {
  const response = await fetch(`${base}/api/release-readiness`, { signal: AbortSignal.timeout(15000) });
  const readiness = await response.json();
  if (!response.ok || !readiness.ok || readiness.releaseCommit !== expected) {
    throw new Error('Both production servers must serve the exact verified release before issuance.');
  }
  for (const asset of ['gold-orbital-base.png', 'gold-ingot.png']) {
    const assetResponse = await fetch(`${base}/assets/frames/${asset}`, { signal: AbortSignal.timeout(15000) });
    if (!assetResponse.ok || !assetResponse.headers.get('content-type')?.startsWith('image/png')) throw new Error('Gold frame asset is not live.');
    await assetResponse.arrayBuffer();
  }
}
const client = new pg.Client({ connectionString: dbVars.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
try {
  await client.connect();
  const previous = await client.query(`SELECT u.id, u.telegram_id, u.session_version, u.profile_frame,
      CASE WHEN u.telegram_id::text = $2 THEN 'gold-bars' ELSE 'money' END AS frame_id
    FROM beta_grants bg JOIN users u ON u.id = bg.user_id
    WHERE bg.code = $1 AND u.deleted_at IS NULL AND u.merged_into_user_id IS NULL`,
    [PERSONAL_FRAME_GIFT_CODE, String(appVars.OWNER_TELEGRAM_ID)]);
  let targets;
  const owner = previous.rows.find((row) => String(row.telegram_id) === String(appVars.OWNER_TELEGRAM_ID) && row.frame_id === 'gold-bars');
  const recipient = previous.rows.find((row) => row.frame_id === 'money' && row.id !== owner?.id);
  if (previous.rows.length === 2 && owner && recipient) {
    // A workflow retry must preserve any later deliberate change of selected frame.
    targets = previous.rows.map((row) => ({ userId: String(row.id), telegramId: String(row.telegram_id), frameId: row.frame_id }));
    console.log(JSON.stringify({ alreadyGranted: true, releaseCommit: expected }));
  } else {
    if (previous.rows.length) throw new Error('Incomplete or unexpected gift receipt requires investigation.');
    const sevTroutTelegramId = await findSevTroutTelegramId(client);
    const input = { ownerTelegramId: appVars.OWNER_TELEGRAM_ID, sevTroutTelegramId };
    const preview = await grantPersonalTelegramFrames(client, input);
    console.log(JSON.stringify({ dryRun: true, targets: preview.targets }));
    targets = (await grantPersonalTelegramFrames(client, { ...input, apply: true })).targets;
  }
  for (const target of targets) {
    const row = (await client.query('SELECT session_version FROM users WHERE id = $1::bigint', [target.userId])).rows[0];
    const session = signSession({ uid: target.userId, platform: 'telegram', sv: Number(row.session_version), exp: Date.now() + 60000 }, appVars.SESSION_SECRET);
    const response = await fetch(`${RAILWAY_PRODUCTION.urls.telegram}/api/me`, {
      headers: { authorization: `Bearer ${session}`, 'x-pivnik-platform': 'telegram' }, signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json();
    const profile = payload.profile || payload;
    if (!response.ok || String(profile.id) !== target.userId || !profile.availableFrames?.some((frame) => frame.code === target.frameId)) {
      throw new Error('Live profile does not expose the awarded frame.');
    }
    if (!previous.rows.length && profile.profileFrame !== target.frameId) throw new Error('Live profile did not select the awarded frame.');
    console.log(JSON.stringify({ verified: true, userId: target.userId, frameId: target.frameId, selectedFrame: profile.profileFrame, releaseCommit: expected }));
  }
} finally { await client.end(); }
