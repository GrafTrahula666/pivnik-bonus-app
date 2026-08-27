import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'PIVNIK_V22_PRODUCT_REBUILD_20260827';

async function read(file) {
  return fs.readFile(path.join(root, file), 'utf8');
}

async function write(file, content) {
  await fs.writeFile(path.join(root, file), content, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`v22: не найден фрагмент «${label}»`);
  return source.replace(from, to);
}

function replacePatternRequired(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) return source;
  if (!pattern.test(source)) throw new Error(`v22: не найден шаблон «${label}»`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function replaceAllRequired(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) return source;
  const matches = source.match(pattern);
  if (!matches?.length) throw new Error(`v22: не найдены фрагменты «${label}»`);
  return source.replace(pattern, replacement);
}

function patchFrameHelpers(source, label) {
  source = replaceRequired(
    source,
    "  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';",
    "  return ['money', 'fire', 'diamond', 'beer-mugs', 'beer-bottles', 'lights', 'middle-finger'].includes(storedFrame) ? storedFrame : 'none';",
    `${label}: распознавание рамок`
  );
  source = replaceRequired(
    source,
    "  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') frames.push({ code: 'diamond', title: 'Алмазная рамка' });\n  return frames;",
    `  if (row?.owns_diamond_frame || String(row?.profile_frame || '') === 'diamond') frames.push({ code: 'diamond', title: 'Алмазная рамка' });
  if (row?.owns_beer_mugs_frame || String(row?.profile_frame || '') === 'beer-mugs') frames.push({ code: 'beer-mugs', title: 'Пивные кружки' });
  if (row?.owns_beer_bottles_frame || String(row?.profile_frame || '') === 'beer-bottles') frames.push({ code: 'beer-bottles', title: 'Пивные бутылки' });
  if (row?.owns_lights_frame || String(row?.profile_frame || '') === 'lights') frames.push({ code: 'lights', title: 'Огоньки' });
  if (row?.owns_middle_finger_frame || String(row?.profile_frame || '') === 'middle-finger') frames.push({ code: 'middle-finger', title: 'Смайлик с факом' });
  return frames;`,
    `${label}: доступные рамки`
  );
  return source;
}

function patchFrameEntitlementSelects(source, label) {
  const pattern = /EXISTS\(\s*SELECT 1 FROM beta_grants bg\s*WHERE bg\.user_id = u\.id AND bg\.code = 'profile-frame-diamond'\s*\) AS owns_diamond_frame/g;
  const replacement = `EXISTS(
              SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-diamond'
            ) AS owns_diamond_frame,
            EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-beer-mugs') AS owns_beer_mugs_frame,
            EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-beer-bottles') AS owns_beer_bottles_frame,
            EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-lights') AS owns_lights_frame,
            EXISTS(SELECT 1 FROM beta_grants bg WHERE bg.user_id = u.id AND bg.code = 'profile-frame-middle-finger') AS owns_middle_finger_frame`;
  return replaceAllRequired(source, pattern, replacement, 'owns_middle_finger_frame', `${label}: entitlement SELECT`);
}

async function patchIndex() {
  let source = await read('index.html');
  source = replacePatternRequired(
    source,
    /(<link rel="stylesheet" href="styles\.css[^"]*"\s*\/>)/,
    `$1\n  <link rel="stylesheet" href="/v22.css?v=22.0.0" />`,
    '/v22.css?v=22.0.0',
    'v22 stylesheet'
  );
  source = replacePatternRequired(
    source,
    /(<script defer src="app\.js[^"]*"><\/script>)/,
    `$1\n  <script defer src="/v22-ui.js?v=22.0.0"></script>`,
    '/v22-ui.js?v=22.0.0',
    'v22 ui script'
  );
  source = replaceRequired(
    source,
    '<button class="icon-btn wheel-back" id="wheelBackButton" type="button" aria-label="Назад">‹</button>',
    '<button class="v22-back-button wheel-back" id="wheelBackButton" type="button" aria-label="Назад"><span aria-hidden="true">←</span><span>Назад</span></button>',
    'кнопка Назад в колесе'
  );
  source = source.replace(
    'Акция доступна авторизованным пользователям Telegram Mini App, достигшим 18 лет',
    'Акция доступна авторизованным пользователям VK или Telegram Mini App, достигшим 18 лет'
  );
  source += source.includes(`<!-- ${MARKER}:index -->`) ? '' : `\n<!-- ${MARKER}:index -->\n`;
  await write('index.html', source);
}

async function patchApp() {
  let source = await read('app.js');
  source = replacePatternRequired(
    source,
    /const APP_VERSION = '[^']+';/,
    "const APP_VERSION = '22.0-pivnik-rebuild';",
    "const APP_VERSION = '22.0-pivnik-rebuild';",
    'версия клиента'
  );

  source = replaceRequired(
    source,
    `function switchScreen(target) {
  if (!target) return;
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('.bottom-nav [data-target]').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
  $('#appShell')?.classList.toggle('service-mode', target === 'staff' || target === 'admin');
  $('#appShell')?.classList.toggle('wheel-mode', target === 'wheel');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (target === 'admin') loadAdmin().catch((error) => toast(error.message));
  if (target === 'staff') openStaffWorkspace().catch((error) => toast(error.message));
  if (target === 'actions') renderPromotions();
  if (target === 'league') renderLeaderboard();
  if (target === 'profile') showHistory().catch((error) => toast(error.message));
}`,
    `function switchScreen(target, navigation = {}) {
  if (!target) return;
  const active = $('.screen.active')?.dataset.screen || null;
  state.screenHistory ||= [];
  if (!navigation.fromHistory && active && active !== target) {
    state.screenHistory.push(active);
    if (state.screenHistory.length > 24) state.screenHistory.shift();
  }
  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('.bottom-nav [data-target]').forEach((button) => button.classList.toggle('active', button.dataset.target === target));
  $('#appShell')?.classList.toggle('service-mode', target === 'staff' || target === 'admin');
  $('#appShell')?.classList.toggle('wheel-mode', target === 'wheel');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (target === 'admin') loadAdmin().catch((error) => toast(error.message));
  if (target === 'staff') openStaffWorkspace().catch((error) => toast(error.message));
  if (target === 'actions') renderPromotions();
  if (target === 'league') renderLeaderboard();
  if (target === 'profile') showHistory().catch((error) => toast(error.message));
}

window.__PIVNIK_GO_BACK__ = () => {
  state.screenHistory ||= [];
  const active = $('.screen.active')?.dataset.screen || 'client';
  let previous = state.screenHistory.pop();
  while (previous === active && state.screenHistory.length) previous = state.screenHistory.pop();
  switchScreen(previous || (active === 'client' ? 'profile' : 'client'), { fromHistory: true });
};`,
    'история экранов'
  );

  source = replaceRequired(
    source,
    "  if (entity.profileFrame === 'diamond') return 'avatar-frame avatar-frame-diamond';",
    `  if (entity.profileFrame === 'diamond') return 'avatar-frame avatar-frame-diamond';
  if (entity.profileFrame === 'beer-mugs') return 'avatar-frame avatar-frame-beer-mugs';
  if (entity.profileFrame === 'beer-bottles') return 'avatar-frame avatar-frame-beer-bottles';
  if (entity.profileFrame === 'lights') return 'avatar-frame avatar-frame-lights';
  if (entity.profileFrame === 'middle-finger') return 'avatar-frame avatar-frame-middle-finger';`,
    'CSS-классы новых рамок'
  );

  source = replaceRequired(
    source,
    `  if (entity.profileFrame === 'vladislav') {
    const poops = Array.from({ length: 12 }, () => '💩');
    return '<span class="avatar-orbit vladislav-orbit" aria-hidden="true">' + poops.map((poop, index) => '<i style="--orbit-index:' + index + ';--counter-angle:' + (-index * 30) + 'deg"><span>' + poop + '</span></i>').join('') + '</span>';
  }
  return '';`,
    `  if (entity.profileFrame === 'vladislav') {
    const poops = Array.from({ length: 12 }, () => '💩');
    return '<span class="avatar-orbit vladislav-orbit" aria-hidden="true">' + poops.map((poop, index) => '<i style="--orbit-index:' + index + ';--counter-angle:' + (-index * 30) + 'deg"><span>' + poop + '</span></i>').join('') + '</span>';
  }
  const v22Orbits = {
    'beer-mugs': '🍺',
    'beer-bottles': '🍾',
    lights: '✦',
    'middle-finger': '🖕'
  };
  if (v22Orbits[entity.profileFrame]) {
    const symbol = v22Orbits[entity.profileFrame];
    return '<span class="avatar-orbit v22-frame-orbit" aria-hidden="true">' + Array.from({ length: 8 }, (_, index) => '<i style="--orbit-index:' + index + '">' + symbol + '</i>').join('') + '</span>';
  }
  return '';`,
    'орбиты новых рамок'
  );

  source = replaceRequired(
    source,
    "  if (!IS_VK) void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));",
    "  void loadWheelStatus().catch((error) => console.warn('Wheel status refresh skipped:', error));",
    'обновление колеса на VK'
  );
  source = replaceRequired(
    source,
    "  if (!IS_VK) jobs.push(loadWheelStatus());",
    "  jobs.push(loadWheelStatus());",
    'загрузка колеса на VK'
  );
  source = replaceRequired(
    source,
    '<div><b>${escapeHtml(leader.name)}${leader.isMe ? \' · вы\' : \'\'}</b><small>Покупки за текущий месяц</small></div>',
    '<div><b>${escapeHtml(leader.name)}${leader.isMe ? \' · вы\' : \'\'}</b><small>${escapeHtml(leader.platformLabel || \'Платформа не определена\')}</small></div>',
    'платформа в Лиге'
  );
  source = replaceRequired(
    source,
    "  if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">✦</span>';",
    "  if (item.icon === 'beta' || item.code === 'beta-tester') return '<span class=\"beta-achievement-icon\">✦</span>';\n  if (item.icon === 'shield' || item.code === 'raise-shields') return '<span class=\"generic-achievement-icon\">◈</span>';",
    'иконка Поднять щиты'
  );
  source += source.includes(`// ${MARKER}:app`) ? '' : `\n// ${MARKER}:app\n`;
  await write('app.js', source);
}

async function patchAchievements() {
  let source = await read('achievements.js');
  source = replaceRequired(
    source,
    `  {
    code: 'twenty-visit-days',
    title: 'Летописец Пивника',
    description: 'Совершайте покупки в 20 разных дней.',
    rarity: 'epic',
    icon: 'calendar',
    metric: 'purchaseDays',
    target: 20,
    rewardBonus: 30
  }
];`,
    `  {
    code: 'twenty-visit-days',
    title: 'Летописец Пивника',
    description: 'Совершайте покупки в 20 разных дней.',
    rarity: 'epic',
    icon: 'calendar',
    metric: 'purchaseDays',
    target: 20,
    rewardBonus: 30
  },
  {
    code: 'raise-shields',
    title: 'Поднять щиты',
    description: 'Особая легендарная награда трём лучшим тестировщикам «Пивника».',
    rarity: 'legendary',
    icon: 'shield',
    metric: 'raiseShieldsGranted',
    target: 1,
    rewardBonus: 750,
    manualOnly: true
  }
];`,
    'легендарное достижение тестеров'
  );
  source = replaceRequired(
    source,
    `    paidBeerMl: number(row.paid_beer_ml),
    previousMonthWinner: 0`,
    `    paidBeerMl: number(row.paid_beer_ml),
    previousMonthWinner: 0,
    raiseShieldsGranted: 0`,
    'ручная метрика тестеров'
  );
  source = replaceRequired(
    source,
    `    for (const definition of ACHIEVEMENT_CATALOG) {
      if (number(metrics[definition.metric]) < definition.target) continue;`,
    `    for (const definition of ACHIEVEMENT_CATALOG) {
      if (definition.manualOnly) continue;
      if (number(metrics[definition.metric]) < definition.target) continue;`,
    'запрет автоматической выдачи спецдостижения'
  );
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
    '100% прогресс уже полученных достижений'
  );
  source += source.includes(`// ${MARKER}:achievements`) ? '' : `\n// ${MARKER}:achievements\n`;
  await write('achievements.js', source);
}

async function patchServer() {
  let source = await read('server.js');
  source = patchFrameHelpers(source, 'server.js');
  source = patchFrameEntitlementSelects(source, 'server.js');

  source = replacePatternRequired(
    source,
    /const DEFAULT_SHOP_ITEMS = \[[\s\S]*?\n\];\nconst QR_ALPHABET/,
    `const DEFAULT_SHOP_ITEMS = [
  { code: 'custom-mug-design', title: 'Кружка с индивидуальным дизайном', subtitle: 'Персональная кружка. Дизайн и детали согласуются с владельцем бара.', category: 'limited', priceType: 'pending', bonusPrice: 0, cashPrice: 0, imageSrc: '', active: true, sortOrder: 10 },
  { code: 'frame-beer-mugs', title: 'Рамка «Пивные кружки»', subtitle: 'Постоянная рамка профиля с пивными кружками.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '', active: true, sortOrder: 20 },
  { code: 'frame-beer-bottles', title: 'Рамка «Пивные бутылки»', subtitle: 'Постоянная рамка профиля с бутылками.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '', active: true, sortOrder: 30 },
  { code: 'frame-lights', title: 'Рамка «Огоньки»', subtitle: 'Постоянная светящаяся рамка профиля.', category: 'profile', priceType: 'bonus', bonusPrice: 1000, cashPrice: 0, imageSrc: '', active: true, sortOrder: 40 },
  { code: 'frame-middle-finger', title: 'Рамка «Смайлик с факом»', subtitle: 'Премиальная постоянная рамка профиля.', category: 'profile', priceType: 'bonus', bonusPrice: 2500, cashPrice: 0, imageSrc: '', active: true, sortOrder: 50 }
];
const FRAME_SHOP_ENTITLEMENTS = Object.freeze({
  'frame-beer-mugs': { frame: 'beer-mugs', grantCode: 'profile-frame-beer-mugs' },
  'frame-beer-bottles': { frame: 'beer-bottles', grantCode: 'profile-frame-beer-bottles' },
  'frame-lights': { frame: 'lights', grantCode: 'profile-frame-lights' },
  'frame-middle-finger': { frame: 'middle-finger', grantCode: 'profile-frame-middle-finger' }
});
const QR_ALPHABET`,
    'FRAME_SHOP_ENTITLEMENTS',
    'новый каталог магазина'
  );

  source = replaceRequired(
    source,
    `    // Старые демонстрационные позиции скрываются только если владелец их не редактировал.
    await client.query("UPDATE shop_items SET active = FALSE WHERE code IN ('craft-05','combo') AND updated_by IS NULL");
    for (const item of DEFAULT_SHOP_ITEMS) {`,
    `    // v22: прежний каталог скрывается один раз без удаления истории покупок.
    const v22ShopReset = await client.query(
      \`INSERT INTO platform_migrations (code)
       VALUES ('v22-shop-catalog-reset-20260827')
       ON CONFLICT (code) DO NOTHING
       RETURNING code\`
    );
    if (v22ShopReset.rowCount) {
      await client.query('UPDATE shop_items SET active = FALSE');
    }
    for (const item of DEFAULT_SHOP_ITEMS) {`,
    'одноразовый reset магазина'
  );

  source = replaceRequired(
    source,
    `    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [target.id]);`,
    `    const frameEntitlement = FRAME_SHOP_ENTITLEMENTS[item.code] || null;
    if (frameEntitlement) {
      const ownedFrame = await client.query(
        'SELECT 1 FROM beta_grants WHERE code = $1 AND user_id = $2::bigint LIMIT 1',
        [frameEntitlement.grantCode, target.id]
      );
      if (ownedFrame.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Эта рамка уже куплена и навсегда доступна в профиле.' });
      }
    }
    const walletResult = await client.query('SELECT balance FROM wallets WHERE user_id = $1 FOR UPDATE', [target.id]);`,
    'защита от повторной покупки рамки'
  );

  source = replaceRequired(
    source,
    `    if (item.code === 'frame-diamond') {
      await client.query(
        \`INSERT INTO beta_grants (code, user_id, amount) VALUES ('profile-frame-diamond', $1::bigint, 0::bigint)
         ON CONFLICT (code, user_id) DO NOTHING\`,
        [target.id]
      );
      await client.query("UPDATE users SET profile_frame = 'diamond', updated_at = NOW() WHERE id = $1::bigint", [target.id]);
    }`,
    `    if (frameEntitlement) {
      await client.query(
        \`INSERT INTO beta_grants (code, user_id, amount) VALUES ($1, $2::bigint, 0::bigint)
         ON CONFLICT (code, user_id) DO NOTHING\`,
        [frameEntitlement.grantCode, target.id]
      );
      await client.query(
        'UPDATE users SET profile_frame = $1, updated_at = NOW() WHERE id = $2::bigint',
        [frameEntitlement.frame, target.id]
      );
    }`,
    'выдача постоянной рамки'
  );

  source = replaceRequired(
    source,
    "         profile_frame = CASE WHEN $1 = 'viewer' THEN 'fire' ELSE 'none' END,",
    "         profile_frame = CASE WHEN $1 = 'viewer' THEN 'fire' ELSE profile_frame END,",
    'сохранение рамки при смене роли'
  );

  source += source.includes(`// ${MARKER}:server`) ? '' : `\n// ${MARKER}:server\n`;
  await write('server.js', source);
}

async function patchUniversalServer() {
  let source = await read('universal-server.js');
  source = patchFrameHelpers(source, 'universal-server.js');
  source = patchFrameEntitlementSelects(source, 'universal-server.js');

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
    'колесо в VK-документе'
  );

  source = replaceRequired(
    source,
    "async function getTelegramWheelStatus(userId, db = pool, nowValue = null) {",
    "async function getTelegramWheelStatus(userId, db = pool, nowValue = null, platform = 'telegram') {",
    'platform-aware status колеса'
  );
  source = replaceRequired(
    source,
    "    platform: 'telegram',\n    freeAvailable:",
    "    platform: platform === 'vk' ? 'vk' : 'telegram',\n    freeAvailable:",
    'platform в status колеса'
  );
  source = replaceRequired(
    source,
    'async function spinTelegramWheel(userId, rawRequestKey) {',
    "async function spinTelegramWheel(userId, rawRequestKey, platform = 'telegram') {",
    'platform-aware spin колеса'
  );
  source = replaceRequired(
    source,
    '      const status = await getTelegramWheelStatus(userId, client, nowResult.rows[0].now);',
    '      const status = await getTelegramWheelStatus(userId, client, nowResult.rows[0].now, platform);',
    'status внутри spin'
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
    'platform в wheel_spins'
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
    'параметр platform wheel_spins'
  );
  source = replaceRequired(
    source,
    '    getTelegramWheelStatus(userId),',
    '    getTelegramWheelStatus(userId, pool, null, platform),',
    'финальный status wheel'
  );

  source = replaceRequired(
    source,
    `      if (platform !== 'telegram') {
        return sendJson(res, 404, { error: 'Колесо доступно только в Telegram.' });
      }
      if (!user.termsAccepted) {`,
    `      if (!user.termsAccepted) {`,
    'GET wheel без ограничения VK'
  );
  source = replaceRequired(
    source,
    '      return sendJson(res, 200, await getTelegramWheelStatus(user.id));',
    '      return sendJson(res, 200, await getTelegramWheelStatus(user.id, pool, null, platform));',
    'GET wheel status platform'
  );
  // The same Telegram-only guard occurs a second time in POST.
  source = replaceRequired(
    source,
    `      if (platform !== 'telegram') {
        return sendJson(res, 404, { error: 'Колесо доступно только в Telegram.' });
      }
      if (!user.termsAccepted) {`,
    `      if (!user.termsAccepted) {`,
    'POST wheel без ограничения VK'
  );
  source = replaceRequired(
    source,
    '      return sendJson(res, 200, await spinTelegramWheel(user.id, body.requestKey));',
    '      return sendJson(res, 200, await spinTelegramWheel(user.id, body.requestKey, platform));',
    'POST wheel platform'
  );

  source = replaceRequired(
    source,
    `  const rows = result.rows;
  const current = rows.find((row) => String(row.id) === String(canonical)) || null;`,
    `  const rows = result.rows;
  const identityResult = rows.length
    ? await pool.query(
        \`SELECT user_id, ARRAY_AGG(DISTINCT provider ORDER BY provider) AS platforms
         FROM user_identities
         WHERE user_id = ANY($1::bigint[])
         GROUP BY user_id\`,
        [rows.map((row) => String(row.id))]
      )
    : { rows: [] };
  const platformMap = new Map(identityResult.rows.map((row) => [
    String(row.user_id),
    Array.isArray(row.platforms) ? row.platforms : []
  ]));
  const current = rows.find((row) => String(row.id) === String(canonical)) || null;`,
    'платформы участников Лиги'
  );
  source = replaceRequired(
    source,
    `        profileFrame: showAvatar ? profileFrameFromRow(row) : 'none',
        showAvatar
      };`,
    `        profileFrame: showAvatar ? profileFrameFromRow(row) : 'none',
        showAvatar,
        platforms: platformMap.get(String(row.id)) || [],
        platformLabel: (() => {
          const platforms = platformMap.get(String(row.id)) || [];
          if (platforms.includes('vk') && platforms.includes('telegram')) return 'VK · Telegram';
          if (platforms.includes('vk')) return 'VK';
          if (platforms.includes('telegram')) return 'Telegram';
          return 'Платформа не определена';
        })()
      };`,
    'platformLabel участника Лиги'
  );

  source = replaceRequired(
    source,
    `    await client.query(
      \`INSERT INTO user_identities (`,
    `    if (externalUser.photoUrl) {
      await client.query(
        \`UPDATE users
         SET avatar_source = 'telegram', updated_at = NOW()
         WHERE id = $1::bigint
           AND onboarding_completed_at IS NULL
           AND avatar_source IN ('preset_male', 'preset_female')\`,
        [userId]
      );
    }

    await client.query(
      \`INSERT INTO user_identities (`,
    'аватар из профиля платформы по умолчанию'
  );

  source += source.includes(`// ${MARKER}:gateway`) ? '' : `\n// ${MARKER}:gateway\n`;
  await write('universal-server.js', source);
}

async function verify() {
  const [index, app, achievements, server, gateway, css, ui] = await Promise.all([
    read('index.html'),
    read('app.js'),
    read('achievements.js'),
    read('server.js'),
    read('universal-server.js'),
    read('v22.css'),
    read('v22-ui.js')
  ]);
  const failures = [];
  if (!index.includes('/v22.css?v=22.0.0') || !index.includes('/v22-ui.js?v=22.0.0')) failures.push('v22 assets');
  if (!app.includes("APP_VERSION = '22.0-pivnik-rebuild'")) failures.push('client version');
  if (!app.includes('window.__PIVNIK_GO_BACK__')) failures.push('back history');
  if (!app.includes("profileFrame === 'middle-finger'")) failures.push('new frame render');
  if (!app.includes("leader.platformLabel || 'Платформа не определена'")) failures.push('league platform UI');
  if (!achievements.includes("code: 'raise-shields'")) failures.push('special achievement');
  if (!server.includes("'frame-middle-finger': { frame: 'middle-finger'")) failures.push('shop frame map');
  if (!server.includes('v22-shop-catalog-reset-20260827')) failures.push('shop reset migration');
  if (!gateway.includes("spinTelegramWheel(user.id, body.requestKey, platform)")) failures.push('VK wheel backend');
  if (gateway.includes('Колесо доступно только в Telegram.')) failures.push('Telegram-only wheel guard');
  if (!gateway.includes("return 'VK · Telegram'")) failures.push('league platform labels');
  if (!css.includes('PIVNIK v22 — red cosmos')) failures.push('red cosmos css');
  if (!ui.includes('v22-admin-tabs')) failures.push('admin tabs ui');
  if (failures.length) throw new Error(`v22 verification failed: ${failures.join(', ')}`);
}

await patchIndex();
await patchApp();
await patchAchievements();
await patchServer();
await patchUniversalServer();
await verify();
console.log('Pivnik v22 product rebuild is applied and verified.');
