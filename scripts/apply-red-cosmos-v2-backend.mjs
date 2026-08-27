import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(file) { return fs.readFile(path.join(root, file), 'utf8'); }
async function write(file, text) { await fs.writeFile(path.join(root, file), text, 'utf8'); }

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`RED COSMOS v2 backend: missing ${label}`);
  return source.replace(from, to);
}

function replacePattern(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) return source;
  if (!pattern.test(source)) throw new Error(`RED COSMOS v2 backend: missing ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

async function patchServer() {
  let source = await read('server.js');

  source = replacePattern(
    source,
    /const DEFAULT_SHOP_ITEMS = \[[\s\S]*?\n\];\nconst QR_ALPHABET/,
    `const DEFAULT_SHOP_ITEMS = [
  { code: 'custom-mug-design', title: 'Кружка с индивидуальным дизайном', subtitle: 'Персональная кружка. Макет и детали согласуются с владельцем Пивника.', category: 'limited', priceType: 'pending', bonusPrice: 0, cashPrice: 0, imageSrc: '/assets/shop/custom-mug-design.svg', active: true, sortOrder: 10 },
  { code: 'frame-beer-mugs', title: 'Пивные кружки', subtitle: 'Постоянная рамка профиля с пивными кружками.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '/assets/shop/frame-beer-mugs.svg', active: true, sortOrder: 20 },
  { code: 'frame-beer-bottles', title: 'Пивные бутылки', subtitle: 'Постоянная рамка профиля с пивными бутылками.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '/assets/shop/frame-beer-bottles.svg', active: true, sortOrder: 30 },
  { code: 'frame-lights', title: 'Огоньки', subtitle: 'Постоянная светящаяся рамка профиля.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '/assets/shop/frame-lights.svg', active: true, sortOrder: 40 },
  { code: 'frame-premium-smiling-fuck', title: 'Смайлик с факом', subtitle: 'Премиальная легендарная рамка профиля.', category: 'profile', priceType: 'bonus', bonusPrice: 2500, cashPrice: 0, imageSrc: '/assets/shop/frame-premium-smiling-fuck.svg', active: true, sortOrder: 50 }
];
const RED_COSMOS_FRAME_ITEMS = Object.freeze({
  'frame-beer-mugs': 'beer-mugs',
  'frame-beer-bottles': 'beer-bottles',
  'frame-lights': 'lights',
  'frame-premium-smiling-fuck': 'premium-smiling-fuck'
});
const QR_ALPHABET`,
    'RED_COSMOS_FRAME_ITEMS',
    'new shop catalog'
  );

  source = replacePattern(
    source,
    /function profileFrameFromRow\(row\) \{[\s\S]*?\n\}\n\nfunction achievementsFromRow/,
    `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row) || String(row?.profile_frame || row?.profileFrame || '') === 'anna') return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  const supported = new Set([
    'money', 'fire', 'diamond', 'olesya', 'vladislav', 'anna',
    'beer-mugs', 'beer-bottles', 'lights', 'premium-smiling-fuck'
  ]);
  return supported.has(storedFrame) ? storedFrame : 'none';
}

function availableFramesFromRow(row) {
  const titles = {
    none: 'Без рамки', money: 'Долларовая рамка', fire: 'Огненная рамка', diamond: 'Алмазная рамка',
    anna: 'Персональная рамка Анны', olesya: 'Рамка из множества сердечек',
    vladislav: 'Рамка Владислава', 'beer-mugs': 'Пивные кружки',
    'beer-bottles': 'Пивные бутылки', lights: 'Огоньки',
    'premium-smiling-fuck': 'Смайлик с факом'
  };
  const owned = new Set(['none']);
  if (isOwnerRow(row)) owned.add('money');
  if (isAnnaRow(row)) owned.add('anna');
  if (row?.role === 'viewer') owned.add('fire');
  if (row?.owns_diamond_frame) owned.add('diamond');
  for (const frame of Array.isArray(row?.owned_frames) ? row.owned_frames : []) owned.add(String(frame));
  const current = String(row?.profile_frame || 'none');
  if (current && current !== 'none') owned.add(current);
  return [...owned].filter((code) => titles[code]).map((code) => ({ code, title: titles[code] }));
}

function achievementsFromRow`,
    'premium-smiling-fuck',
    'frame entitlement helpers'
  );

  const diamondSelect = "EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-diamond') AS owns_diamond_frame";
  const framesSelect = `${diamondSelect},\n            ARRAY(SELECT uf.frame_id FROM user_frames uf WHERE uf.user_id = u.id ORDER BY uf.acquired_at, uf.id) AS owned_frames`;
  if (!source.includes('AS owned_frames')) {
    const count = source.split(diamondSelect).length - 1;
    if (count < 2) throw new Error('RED COSMOS v2 backend: expected profile frame SELECTs');
    source = source.split(diamondSelect).join(framesSelect);
  }

  source = replaceRequired(
    source,
    "    await client.query(\"ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS cash_price INTEGER NOT NULL DEFAULT 0\");",
    `    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS cash_price INTEGER NOT NULL DEFAULT 0");
    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE");
    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS is_purchasable BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE shop_items ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ");`,
    'shop visibility columns'
  );

  source = replaceRequired(
    source,
    "    // Старые демонстрационные позиции скрываются только если владелец их не редактировал.\n    await client.query(\"UPDATE shop_items SET active = FALSE WHERE code IN ('craft-05','combo') AND updated_by IS NULL\");\n    for (const item of DEFAULT_SHOP_ITEMS) {",
    `    // RED COSMOS v2: old items stay in DB for audit/admin, but never leak into the client catalog.
    await client.query(\`UPDATE shop_items
      SET active = FALSE, is_hidden = TRUE, is_purchasable = FALSE,
          hidden_at = COALESCE(hidden_at, NOW()), updated_at = NOW()
      WHERE code NOT IN ('custom-mug-design','frame-beer-mugs','frame-beer-bottles','frame-lights','frame-premium-smiling-fuck')\`);
    for (const item of DEFAULT_SHOP_ITEMS) {`,
    'hide legacy shop rows'
  );

  source = replaceRequired(
    source,
    `      await client.query(
        \`UPDATE shop_items
         SET title=$2, subtitle=$3, category=$4, price_type=$5, bonus_price=$6, cash_price=$7, image_src=COALESCE(image_src,$8), active=$9, sort_order=$10, updated_at=NOW()
         WHERE code=$1 AND updated_by IS NULL\`,
        [item.code, item.title, item.subtitle, item.category, item.priceType, item.bonusPrice, item.cashPrice, item.imageSrc || null, item.active, item.sortOrder]
      );
    }`,
    `      await client.query(
        \`UPDATE shop_items
         SET title=$2, subtitle=$3, category=$4, price_type=$5, bonus_price=$6, cash_price=$7,
             image_src=$8, active=$9, sort_order=$10,
             is_hidden=FALSE, is_purchasable=($5 = 'bonus' AND $6 > 0), hidden_at=NULL, updated_at=NOW()
         WHERE code=$1\`,
        [item.code, item.title, item.subtitle, item.category, item.priceType, item.bonusPrice, item.cashPrice, item.imageSrc || null, item.active, item.sortOrder]
      );
    }`,
    'activate only v2 shop rows'
  );

  const catalogRoute = `app.get('/api/shop/catalog', authRequired, async (_req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM shop_items ORDER BY sort_order, id');
    res.json({ items: result.rows.map(shopItemResponse), note: 'Каталог разделён по категориям. Товары за бонусы выдаёт сотрудник по QR, рублёвые позиции оплачиваются в баре.' });
  } catch (error) {
    next(error);
  }
});`;

  const v2Routes = `app.get('/api/profile/frames', authRequired, async (req, res, next) => {
  try {
    const result = await pool.query(
      \`SELECT frame_id, acquired_source, acquired_at, restored_from_legacy
       FROM user_frames WHERE user_id = $1::bigint ORDER BY acquired_at, id\`,
      [req.user.id]
    );
    res.json({
      frames: result.rows.map((row) => ({
        frameId: row.frame_id,
        acquiredSource: row.acquired_source,
        acquiredAt: row.acquired_at,
        restoredFromLegacy: Boolean(row.restored_from_legacy)
      })),
      selectedFrame: req.user.profileFrame || 'none'
    });
  } catch (error) { next(error); }
});

app.post('/api/shop/buy', authRequired, async (req, res, next) => {
  const itemCode = String(req.body?.itemCode || '').trim();
  const requestKey = normalizeRequestKey(req.body?.requestKey);
  if (!itemCode) return res.status(400).json({ error: 'Товар не выбран.' });
  if (!requestKey) return res.status(400).json({ error: 'Некорректный requestKey покупки.' });
  const storedRequestKey = 'self-shop:' + req.user.id + ':' + requestKey;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockRequestKey(client, storedRequestKey);
    const replay = await client.query(
      \`SELECT sp.item_code, sp.bonus_price, t.*
       FROM shop_purchases sp JOIN transactions t ON t.id = sp.transaction_id
       WHERE sp.request_key = $1\`, [storedRequestKey]
    );
    if (replay.rowCount) {
      await client.query('COMMIT');
      return res.json({ success: true, idempotent: true, itemCode: replay.rows[0].item_code, profile: await getProfile(req.user.id) });
    }

    const itemResult = await client.query(
      \`SELECT * FROM shop_items
       WHERE code=$1 AND active=TRUE AND is_hidden=FALSE AND is_purchasable=TRUE
         AND price_type='bonus' AND bonus_price>0
       FOR SHARE\`, [itemCode]
    );
    if (!itemResult.rowCount) throw Object.assign(new Error('Товар недоступен для покупки.'), { statusCode: 404 });
    const item = itemResult.rows[0];
    const frameId = RED_COSMOS_FRAME_ITEMS[item.code] || null;
    if (!frameId) throw Object.assign(new Error('Этот товар оформляется через владельца Пивника.'), { statusCode: 409 });

    const alreadyOwned = await client.query(
      'SELECT 1 FROM user_frames WHERE user_id=$1::bigint AND frame_id=$2 LIMIT 1',
      [req.user.id, frameId]
    );
    if (alreadyOwned.rowCount) throw Object.assign(new Error('✓ Куплено. Эта рамка уже навсегда доступна в профиле.'), { statusCode: 409 });

    const account = await client.query(
      \`SELECT u.role, u.unlimited_bonus, w.balance
       FROM users u JOIN wallets w ON w.user_id=u.id
       WHERE u.id=$1::bigint AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       FOR UPDATE OF u,w\`, [req.user.id]
    );
    if (!account.rowCount) throw Object.assign(new Error('Пользователь не найден.'), { statusCode: 404 });
    const unlimitedBonus = hasUnlimitedBonus(account.rows[0]);
    const balance = unlimitedBonus ? UNLIMITED_BONUS_BALANCE : Number(account.rows[0].balance || 0);
    const price = Number(item.bonus_price || 0);
    if (!unlimitedBonus && balance < price) throw Object.assign(new Error('Недостаточно бонусов.'), { statusCode: 400 });
    const balanceAfter = unlimitedBonus ? UNLIMITED_BONUS_BALANCE : balance - price;
    if (!unlimitedBonus) {
      await client.query('UPDATE wallets SET balance=$1::bigint, updated_at=NOW() WHERE user_id=$2::bigint', [balanceAfter, req.user.id]);
    }
    const tx = await client.query(
      \`INSERT INTO transactions (
         request_key, client_id, mode, status, bonus_spent, balance_after,
         reason, reward_code, completed_at
       ) VALUES ($1,$2::bigint,'shop','completed',$3::bigint,$4::bigint,$5,$6,NOW())
       RETURNING *\`,
      [storedRequestKey, req.user.id, price, balanceAfter, 'Магазин: ' + item.title, 'shop:' + item.code]
    );
    await client.query(
      \`INSERT INTO shop_purchases (request_key,user_id,item_code,bonus_price,transaction_id)
       VALUES ($1,$2::bigint,$3,$4::bigint,$5::bigint)\`,
      [storedRequestKey, req.user.id, item.code, price, tx.rows[0].id]
    );
    await client.query(
      \`INSERT INTO user_frames (user_id,frame_id,acquired_source,purchase_transaction_id)
       VALUES ($1::bigint,$2,'shop',$3::bigint)
       ON CONFLICT (user_id,frame_id) DO NOTHING\`,
      [req.user.id, frameId, tx.rows[0].id]
    );
    await client.query('UPDATE users SET profile_frame=$1, updated_at=NOW() WHERE id=$2::bigint', [frameId, req.user.id]);
    await client.query('COMMIT');
    await syncUserAchievements(pool, req.user.id);
    return res.json({ success: true, idempotent: false, itemCode: item.code, frameId, remainingBalance: balanceAfter, profile: await getProfile(req.user.id) });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  } finally { client.release(); }
});

app.get('/api/admin/achievements-v2', authRequired, requireRole('viewer','admin'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      \`SELECT ua.user_id, u.username, u.first_name, ua.achievement_code, ua.is_granted,
              ua.current_progress, ua.required_progress, ua.granted_at, ua.last_progress_check_at
       FROM user_achievements_v2 ua JOIN users u ON u.id=ua.user_id
       WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       ORDER BY ua.is_granted DESC, ua.granted_at DESC NULLS LAST, ua.user_id, ua.achievement_code\`
    );
    res.json({ achievements: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/admin/frames', authRequired, requireRole('viewer','admin'), async (_req, res, next) => {
  try {
    const result = await pool.query(
      \`SELECT uf.user_id, u.username, u.first_name, uf.frame_id, uf.acquired_source,
              uf.acquired_at, uf.restored_from_legacy, u.profile_frame AS selected_frame
       FROM user_frames uf JOIN users u ON u.id=uf.user_id
       WHERE u.merged_into_user_id IS NULL AND u.deleted_at IS NULL
       ORDER BY uf.acquired_at DESC, uf.id DESC\`
    );
    res.json({ frames: result.rows });
  } catch (error) { next(error); }
});

app.get('/api/shop/catalog', authRequired, async (_req, res, next) => {
  try {
    const result = await pool.query(
      \`SELECT * FROM shop_items
       WHERE active=TRUE AND is_hidden=FALSE
       ORDER BY sort_order,id\`
    );
    res.json({ items: result.rows.map(shopItemResponse), note: 'RED COSMOS: четыре постоянные рамки за бонусы и индивидуальная кружка по запросу.' });
  } catch (error) { next(error); }
});`;

  source = replaceRequired(source, catalogRoute, v2Routes, 'client shop and v2 admin routes');
  source += source.includes('// RED_COSMOS_V2_BACKEND_SERVER') ? '' : '\n// RED_COSMOS_V2_BACKEND_SERVER\n';
  await write('server.js', source);
}

async function patchGateway() {
  let source = await read('universal-server.js');

  source = replaceRequired(
    source,
    `  return withLinking
    .replace(
      /<!-- telegram-wheel:start -->[\\s\\S]*?<!-- telegram-wheel:end -->/g,
      ''
    )
    .replace(/<script defer src="https:\\/\\/telegram\\.org\\/js\\/telegram-web-app\\.js[^>]*><\\/script>\\s*/i, '')`,
    `  return withLinking
    .replace(/<script defer src="https:\\/\\/telegram\\.org\\/js\\/telegram-web-app\\.js[^>]*><\\/script>\\s*/i, '')`,
    'VK render must retain wheel markup'
  );

  source = replaceRequired(
    source,
    "async function getTelegramWheelStatus(userId, db = pool, nowValue = null) {",
    "async function getTelegramWheelStatus(userId, db = pool, nowValue = null, platform = 'telegram') {",
    'shared wheel status signature'
  );
  source = replaceRequired(
    source,
    "    platform: 'telegram',\n    freeAvailable:",
    "    platform: platform === 'vk' ? 'vk' : 'telegram',\n    freeAvailable:",
    'shared wheel status platform'
  );
  source = replaceRequired(
    source,
    'async function spinTelegramWheel(userId, rawRequestKey) {',
    "async function spinTelegramWheel(userId, rawRequestKey, platform = 'telegram') {",
    'shared wheel spin signature'
  );
  source = replaceRequired(
    source,
    '      const status = await getTelegramWheelStatus(userId, client, nowResult.rows[0].now);',
    '      const status = await getTelegramWheelStatus(userId, client, nowResult.rows[0].now, platform);',
    'shared wheel transaction status'
  );
  source = replaceRequired(
    source,
    `         ) VALUES (
           $1, $2::bigint, 'telegram', $3,
           $4::bigint, $5::bigint, $6,
           $7::bigint, $8::integer, $9::integer
         )`,
    `         ) VALUES (
           $1, $2::bigint, $10, $3,
           $4::bigint, $5::bigint, $6,
           $7::bigint, $8::integer, $9::integer
         )`,
    'wheel platform insert'
  );
  source = replaceRequired(
    source,
    `          prize.beerMl,
          ticket
        ]`,
    `          prize.beerMl,
          ticket,
          platform === 'vk' ? 'vk' : 'telegram'
        ]`,
    'wheel platform parameter'
  );
  source = replaceRequired(
    source,
    '    getTelegramWheelStatus(userId),',
    '    getTelegramWheelStatus(userId, pool, null, platform),',
    'wheel response status platform'
  );

  const telegramGuard = `      if (platform !== 'telegram') {
        return sendJson(res, 404, { error: 'Колесо доступно только в Telegram.' });
      }
`;
  let guards = 0;
  while (source.includes(telegramGuard)) {
    source = source.replace(telegramGuard, '');
    guards += 1;
  }
  if (guards !== 0 && guards !== 2) throw new Error(`RED COSMOS v2 backend: expected 0 or 2 wheel guards, got ${guards}`);

  source = replaceRequired(
    source,
    '      return sendJson(res, 200, await getTelegramWheelStatus(user.id));',
    '      return sendJson(res, 200, await getTelegramWheelStatus(user.id, pool, null, platform));',
    'GET shared wheel route'
  );
  source = replaceRequired(
    source,
    '      return sendJson(res, 200, await spinTelegramWheel(user.id, body.requestKey));',
    '      return sendJson(res, 200, await spinTelegramWheel(user.id, body.requestKey, platform));',
    'POST shared wheel route'
  );

  source += source.includes('// RED_COSMOS_V2_BACKEND_GATEWAY') ? '' : '\n// RED_COSMOS_V2_BACKEND_GATEWAY\n';
  await write('universal-server.js', source);
}

async function patchAchievements() {
  let source = await read('achievements.js');

  if (!source.includes('RED_COSMOS_V2_ACHIEVEMENT_PROGRESS_CACHE')) {
    source = replaceRequired(
      source,
      `    for (const definition of ACHIEVEMENT_CATALOG) {
      if (number(metrics[definition.metric]) < definition.target) continue;
      const periodKey = definition.recurring === 'monthly' ? monthly.periodKey : '';
      if (definition.recurring === 'monthly' && !periodKey) continue;
      if (await awardAchievement(client, userId, definition, periodKey)) {
        granted.push(grantCode(definition, periodKey));
      }
    }
    await client.query('COMMIT');`,
      `    for (const definition of ACHIEVEMENT_CATALOG) {
      if (number(metrics[definition.metric]) < definition.target) continue;
      const periodKey = definition.recurring === 'monthly' ? monthly.periodKey : '';
      if (definition.recurring === 'monthly' && !periodKey) continue;
      if (await awardAchievement(client, userId, definition, periodKey)) {
        granted.push(grantCode(definition, periodKey));
      }
    }

    const earnedRows = await client.query(
      \`SELECT achievement_code, MIN(created_at) AS granted_at, MAX(announced_at) AS announced_at
       FROM reward_grants
       WHERE user_id=$1::bigint AND source='achievement' AND achievement_code IS NOT NULL
       GROUP BY achievement_code\`,
      [userId]
    );
    const earnedMap = new Map(earnedRows.rows.map((row) => [row.achievement_code, row]));
    for (const definition of ACHIEVEMENT_CATALOG) {
      const current = Math.max(0, number(metrics[definition.metric]));
      const earnedRow = earnedMap.get(definition.code);
      await client.query(
        \`INSERT INTO user_achievements_v2 (
           user_id, achievement_code, is_granted, granted_at,
           current_progress, required_progress, last_progress_check_at,
           first_unlock_notification_sent_at
         ) VALUES ($1::bigint,$2,$3,$4,$5::bigint,$6::bigint,NOW(),$7)
         ON CONFLICT (user_id,achievement_code) DO UPDATE SET
           is_granted = user_achievements_v2.is_granted OR EXCLUDED.is_granted,
           granted_at = COALESCE(user_achievements_v2.granted_at, EXCLUDED.granted_at),
           current_progress = EXCLUDED.current_progress,
           required_progress = EXCLUDED.required_progress,
           last_progress_check_at = NOW(),
           first_unlock_notification_sent_at = COALESCE(user_achievements_v2.first_unlock_notification_sent_at, EXCLUDED.first_unlock_notification_sent_at)\`,
        [
          userId,
          definition.code,
          Boolean(earnedRow),
          earnedRow?.granted_at || null,
          Math.min(current, number(definition.target)),
          number(definition.target),
          earnedRow?.announced_at || null
        ]
      );
    }
    // RED_COSMOS_V2_ACHIEVEMENT_PROGRESS_CACHE
    await client.query('COMMIT');`,
      'achievement progress cache'
    );
  }

  if (!source.includes("label: 'Получено'")) {
    source = replaceRequired(
      source,
      `  const achievements = evaluateAchievementCatalog(metrics).map((item) => ({
    ...item,
    ...(awarded.byCode.get(item.code) || {
      earned: false,
      locked: true,
      grantCode: null,
      grantedAt: null,
      announced: false,
      periodKey: null
    })
  }));`,
      `  const achievements = evaluateAchievementCatalog(metrics).map((item) => {
    const merged = {
      ...item,
      ...(awarded.byCode.get(item.code) || {
        earned: false,
        locked: true,
        grantCode: null,
        grantedAt: null,
        announced: false,
        periodKey: null
      })
    };
    if (merged.earned) {
      merged.progress = {
        ...(merged.progress || {}),
        current: merged.progress?.target || 1,
        percent: 100,
        label: 'Получено'
      };
    }
    return merged;
  });`,
      'earned achievement UI state'
    );
  }

  source += source.includes('// RED_COSMOS_V2_ACHIEVEMENTS') ? '' : '\n// RED_COSMOS_V2_ACHIEVEMENTS\n';
  await write('achievements.js', source);
}

await patchServer();
await patchGateway();
await patchAchievements();
console.log('RED COSMOS v2 backend materialized: achievements, frames, shop and VK/TG wheel.');
