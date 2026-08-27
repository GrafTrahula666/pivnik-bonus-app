import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
const gatewayPath = path.join(root, 'universal-server.js');
const MARKER_SERVER = '// RED_COSMOS_V2_FINAL_SERVER_RUNTIME';
const MARKER_GATEWAY = '// RED_COSMOS_V2_FINAL_GATEWAY_RUNTIME';

function replaceOrThrow(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`RED COSMOS v2 backend: missing ${label}`);
  return source.replace(from, to);
}

function addPremiumFrameSupport(source, label) {
  if (!source.includes("'premium-smiling-fuck'")) {
    source = source.replace(
      "'money', 'fire', 'diamond', 'beer-mugs', 'beer-bottles', 'lights', 'middle-finger'",
      "'money', 'fire', 'diamond', 'beer-mugs', 'beer-bottles', 'lights', 'middle-finger', 'premium-smiling-fuck'"
    );
    source = source.replace(
      "if (row?.owns_middle_finger_frame || String(row?.profile_frame || '') === 'middle-finger') frames.push({ code: 'middle-finger', title: 'Смайлик с факом' });",
      "if (row?.owns_middle_finger_frame || String(row?.profile_frame || '') === 'middle-finger') frames.push({ code: 'middle-finger', title: 'Смайлик с факом (legacy)' });\n  if (row?.owns_premium_smiling_fuck_frame || String(row?.profile_frame || '') === 'premium-smiling-fuck') frames.push({ code: 'premium-smiling-fuck', title: 'Смайлик с факом' });"
    );
  }
  if (!source.includes('owns_premium_smiling_fuck_frame')) {
    source = source.replaceAll(
      "EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-middle-finger') AS owns_middle_finger_frame",
      "EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-middle-finger') AS owns_middle_finger_frame,\n            EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-premium-smiling-fuck') AS owns_premium_smiling_fuck_frame"
    );
  }
  if (!source.includes("'premium-smiling-fuck'")) throw new Error(`RED COSMOS v2 backend: ${label} premium frame support failed`);
  return source;
}

let server = await fs.readFile(serverPath, 'utf8');
if (!server.includes(MARKER_SERVER)) {
  const catalogPattern = /const DEFAULT_SHOP_ITEMS = \[[\s\S]*?\n\];\nconst FRAME_SHOP_ENTITLEMENTS = Object\.freeze\(\{[\s\S]*?\n\}\);\nconst QR_ALPHABET/;
  if (!catalogPattern.test(server)) throw new Error('RED COSMOS v2 backend: v22 shop catalog not materialized');
  server = server.replace(catalogPattern, `const DEFAULT_SHOP_ITEMS = [
  { code: 'frame-beer-mugs', title: 'Пивные кружки', subtitle: 'Постоянная рамка профиля с пивными кружками.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '/assets/shop/frame-beer-mugs.svg', active: true, sortOrder: 10 },
  { code: 'frame-beer-bottles', title: 'Пивные бутылки', subtitle: 'Постоянная рамка профиля с пивными бутылками.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '/assets/shop/frame-beer-bottles.svg', active: true, sortOrder: 20 },
  { code: 'frame-lights', title: 'Огоньки', subtitle: 'Постоянная светящаяся рамка профиля.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '/assets/shop/frame-lights.svg', active: true, sortOrder: 30 },
  { code: 'frame-premium-smiling-fuck', title: 'Смайлик с факом', subtitle: 'Премиальная легендарная рамка профиля.', category: 'profile', priceType: 'bonus', bonusPrice: 2500, cashPrice: 0, imageSrc: '/assets/shop/frame-premium-smiling-fuck.svg', active: true, sortOrder: 40 }
];
const FRAME_SHOP_ENTITLEMENTS = Object.freeze({
  'frame-beer-mugs': { frame: 'beer-mugs', grantCode: 'profile-frame-beer-mugs' },
  'frame-beer-bottles': { frame: 'beer-bottles', grantCode: 'profile-frame-beer-bottles' },
  'frame-lights': { frame: 'lights', grantCode: 'profile-frame-lights' },
  'frame-premium-smiling-fuck': { frame: 'premium-smiling-fuck', grantCode: 'profile-frame-premium-smiling-fuck' }
});
const QR_ALPHABET`);

  server = addPremiumFrameSupport(server, 'server');

  const oldReset = `    // v22: прежний каталог скрывается один раз без удаления истории покупок.
    const v22ShopReset = await client.query(
      \`INSERT INTO platform_migrations (code)
       VALUES ('v22-shop-catalog-reset-20260827')
       ON CONFLICT (code) DO NOTHING
       RETURNING code\`
    );
    if (v22ShopReset.rowCount) {
      await client.query('UPDATE shop_items SET active = FALSE');
    }
    for (const item of DEFAULT_SHOP_ITEMS) {`;
  const newReset = `    // RED COSMOS v2: old rows remain for audit/admin, but the client catalog is always exactly four frames.
    await client.query(\`UPDATE shop_items
      SET active = FALSE, updated_at = NOW()
      WHERE code NOT IN ('frame-beer-mugs','frame-beer-bottles','frame-lights','frame-premium-smiling-fuck')\`);
    for (const item of DEFAULT_SHOP_ITEMS) {`;
  server = replaceOrThrow(server, oldReset, newReset, 'v22 one-time shop reset');

  server = server.replace(
    'SET title=$2, subtitle=$3, category=$4, price_type=$5, bonus_price=$6, cash_price=$7, image_src=COALESCE(image_src,$8), active=$9, sort_order=$10, updated_at=NOW()\n         WHERE code=$1 AND updated_by IS NULL',
    'SET title=$2, subtitle=$3, category=$4, price_type=$5, bonus_price=$6, cash_price=$7, image_src=$8, active=$9, sort_order=$10, updated_at=NOW()\n         WHERE code=$1'
  );

  server = replaceOrThrow(
    server,
    "    const result = await pool.query('SELECT * FROM shop_items ORDER BY sort_order, id');\n    res.json({ items: result.rows.map(shopItemResponse), note: 'Каталог разделён по категориям. Товары за бонусы выдаёт сотрудник по QR, рублёвые позиции оплачиваются в баре.' });",
    "    const result = await pool.query(\"SELECT * FROM shop_items WHERE active=TRUE AND code IN ('frame-beer-mugs','frame-beer-bottles','frame-lights','frame-premium-smiling-fuck') ORDER BY sort_order, id\");\n    res.json({ items: result.rows.map(shopItemResponse), note: 'RED COSMOS: четыре постоянные рамки за бонусы.' });",
    'client shop filter'
  );

  if (!server.includes("app.post('/api/shop/buy'")) {
    const anchor = "app.get('/api/shop/contact', authRequired, async (_req, res, next) => {";
    if (!server.includes(anchor)) throw new Error('RED COSMOS v2 backend: shop contact anchor missing');
    const routes = `app.get('/api/profile/frames', authRequired, async (req, res, next) => {
  try {
    const rows = await pool.query(
      \`SELECT frame_id, acquired_source, acquired_at, restored_from_legacy
       FROM user_frames WHERE user_id=$1::bigint ORDER BY acquired_at,id\`, [req.user.id]
    );
    res.json({ frames: rows.rows, selectedFrame: req.user.profileFrame || 'none' });
  } catch (error) { next(error); }
});

app.post('/api/shop/buy', authRequired, async (req, res, next) => {
  const itemCode = String(req.body?.itemCode || '').trim();
  const requestKey = normalizeRequestKey(req.body?.requestKey);
  if (!itemCode || !requestKey) return res.status(400).json({ error: 'Некорректная покупка.' });
  const entitlement = FRAME_SHOP_ENTITLEMENTS[itemCode] || null;
  if (!entitlement) return res.status(404).json({ error: 'Товар недоступен.' });
  const storedKey = 'self-shop:' + req.user.id + ':' + requestKey;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [storedKey]);
    const replay = await client.query('SELECT item_code, bonus_price FROM shop_purchases WHERE request_key=$1', [storedKey]);
    if (replay.rowCount) {
      await client.query('COMMIT');
      return res.json({ success: true, idempotent: true, itemCode: replay.rows[0].item_code, profile: await getProfile(req.user.id) });
    }
    const itemResult = await client.query(
      \`SELECT * FROM shop_items WHERE code=$1 AND active=TRUE AND price_type='bonus' AND bonus_price>0 FOR SHARE\`, [itemCode]
    );
    if (!itemResult.rowCount) throw Object.assign(new Error('Товар недоступен для покупки.'), { statusCode: 404 });
    const owned = await client.query('SELECT 1 FROM beta_grants WHERE code=$1 AND user_id=$2::bigint LIMIT 1', [entitlement.grantCode, req.user.id]);
    if (owned.rowCount) throw Object.assign(new Error('✓ Куплено. Эта рамка уже навсегда доступна.'), { statusCode: 409 });
    const account = await client.query(
      \`SELECT u.role,u.unlimited_bonus,w.balance FROM users u JOIN wallets w ON w.user_id=u.id
       WHERE u.id=$1::bigint AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL FOR UPDATE OF u,w\`, [req.user.id]
    );
    if (!account.rowCount) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });
    const unlimited = hasUnlimitedBonus(account.rows[0]);
    const price = Number(itemResult.rows[0].bonus_price || 0);
    const balance = unlimited ? UNLIMITED_BONUS_BALANCE : Number(account.rows[0].balance || 0);
    if (!unlimited && balance < price) throw Object.assign(new Error('Недостаточно бонусов.'), { statusCode: 400 });
    const balanceAfter = unlimited ? UNLIMITED_BONUS_BALANCE : balance - price;
    if (!unlimited) await client.query('UPDATE wallets SET balance=$1::bigint,updated_at=NOW() WHERE user_id=$2::bigint', [balanceAfter, req.user.id]);
    const tx = await client.query(
      \`INSERT INTO transactions(request_key,client_id,mode,status,bonus_spent,balance_after,reason,reward_code,completed_at)
       VALUES($1,$2::bigint,'shop','completed',$3::bigint,$4::bigint,$5,$6,NOW()) RETURNING id\`,
      [storedKey, req.user.id, price, balanceAfter, 'Магазин: ' + itemResult.rows[0].title, 'shop:' + itemCode]
    );
    await client.query('INSERT INTO beta_grants(code,user_id,amount) VALUES($1,$2::bigint,0) ON CONFLICT(code,user_id) DO NOTHING', [entitlement.grantCode, req.user.id]);
    await client.query(
      \`INSERT INTO user_frames(user_id,frame_id,acquired_source,purchase_transaction_id)
       VALUES($1::bigint,$2,'shop',$3::bigint) ON CONFLICT(user_id,frame_id) DO NOTHING\`,
      [req.user.id, entitlement.frame, tx.rows[0].id]
    );
    await client.query(
      'INSERT INTO shop_purchases(request_key,user_id,item_code,bonus_price,transaction_id) VALUES($1,$2::bigint,$3,$4::bigint,$5::bigint)',
      [storedKey, req.user.id, itemCode, price, tx.rows[0].id]
    );
    await client.query('UPDATE users SET profile_frame=$1,updated_at=NOW() WHERE id=$2::bigint', [entitlement.frame, req.user.id]);
    await client.query('COMMIT');
    await syncUserAchievements(pool, req.user.id);
    res.json({ success: true, itemCode, frameId: entitlement.frame, remainingBalance: balanceAfter, profile: await getProfile(req.user.id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  } finally { client.release(); }
});

app.get('/api/admin/frames', authRequired, requireRole('viewer','admin'), async (_req, res, next) => {
  try {
    const result = await pool.query(\`SELECT uf.user_id,uf.frame_id,uf.acquired_source,uf.acquired_at,uf.restored_from_legacy,u.first_name,u.username,u.profile_frame AS selected_frame
      FROM user_frames uf JOIN users u ON u.id=uf.user_id ORDER BY uf.acquired_at DESC,uf.id DESC LIMIT 1000\`);
    res.json({ frames: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/admin/achievements-v2', authRequired, requireRole('viewer','admin'), async (_req, res, next) => {
  try {
    const result = await pool.query(\`SELECT ua.*,u.first_name,u.username FROM user_achievements_v2 ua JOIN users u ON u.id=ua.user_id ORDER BY ua.is_granted DESC,ua.granted_at DESC NULLS LAST,ua.user_id,ua.achievement_code LIMIT 2000\`);
    res.json({ achievements: result.rows });
  } catch (error) { next(error); }
});

${anchor}`;
    server = server.replace(anchor, routes);
  }

  server += `\n${MARKER_SERVER}\n`;
}

let gateway = await fs.readFile(gatewayPath, 'utf8');
if (!gateway.includes(MARKER_GATEWAY)) {
  gateway = addPremiumFrameSupport(gateway, 'gateway');
  gateway += `\n${MARKER_GATEWAY}\n`;
}

const requiredServer = [
  "code: 'frame-beer-mugs'", "code: 'frame-beer-bottles'", "code: 'frame-lights'", "code: 'frame-premium-smiling-fuck'",
  "app.post('/api/shop/buy'", "app.get('/api/admin/frames'", "app.get('/api/admin/achievements-v2'",
  "profile-frame-premium-smiling-fuck", '/assets/shop/frame-premium-smiling-fuck.svg'
];
for (const token of requiredServer) if (!server.includes(token)) throw new Error(`RED COSMOS v2 backend verification missing ${token}`);
if (server.includes("code: 'custom-mug-design'")) throw new Error('RED COSMOS v2 backend: custom mug leaked into visible defaults');
if (!gateway.includes("'premium-smiling-fuck'")) throw new Error('RED COSMOS v2 backend: gateway premium frame missing');

await fs.writeFile(serverPath, server, 'utf8');
await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('RED COSMOS v2 backend finalized: four-item shop, permanent frames and admin endpoints.');
