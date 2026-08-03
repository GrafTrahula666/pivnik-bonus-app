import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function patchFile(fileName, replacements) {
  const filePath = path.join(__dirname, fileName);
  let content = await fs.readFile(filePath, 'utf8');
  let changed = false;

  for (const { from, to, label } of replacements) {
    if (content.includes(to)) continue;
    if (!content.includes(from)) {
      throw new Error(`Не найден фрагмент для исправления: ${label}`);
    }
    content = content.replace(from, to);
    changed = true;
  }

  if (changed) await fs.writeFile(filePath, content, 'utf8');
}

await patchFile('server.js', [
  {
    label: 'идентификатор Олеси',
    from: "const annaTelegramId = String(process.env.ANNA_TELEGRAM_ID || '').trim();\nconst appleWalletIssuerUrl",
    to: "const annaTelegramId = String(process.env.ANNA_TELEGRAM_ID || '').trim();\nconst olesyaTelegramId = String(process.env.OLESYA_TELEGRAM_ID || '').trim();\nconst appleWalletIssuerUrl"
  },
  {
    label: 'сердечная рамка в профиле сервера',
    from: `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row)) return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  if (storedFrame === 'anna') return 'none';
  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';
}`,
    to: `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row)) return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  if (storedFrame === 'olesya') return 'olesya';
  if (storedFrame === 'anna') return 'none';
  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';
}`
  },
  {
    label: 'доступная рамка Олеси на сервере',
    from: `function availableFramesFromRow(row) {
  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];
  if (isAnnaRow(row)) return [{ code: 'anna', title: 'Персональная рамка Анны' }];
  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];`,
    to: `function availableFramesFromRow(row) {
  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];
  if (isAnnaRow(row)) return [{ code: 'anna', title: 'Персональная рамка Анны' }];
  if (String(row?.profile_frame || '') === 'olesya') return [{ code: 'olesya', title: 'Рамка из множества сердечек' }];
  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];`
  },
  {
    label: 'разовое начисление Олесе',
    from: `async function initDatabase() {
  const client = await pool.connect();`,
    to: `async function resolveOlesyaRow(db, userId = null) {
  if (olesyaTelegramId) {
    const exact = await db.query(
      \`SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.profile_frame, w.balance
       FROM users u
       JOIN wallets w ON w.user_id = u.id
       WHERE u.telegram_id::text = $1
         AND u.merged_into_user_id IS NULL
         AND u.deleted_at IS NULL
       LIMIT 1\`,
      [olesyaTelegramId]
    );
    if (!exact.rowCount) return null;
    if (userId !== null && String(exact.rows[0].id) !== String(userId)) return null;
    return exact.rows[0];
  }

  const candidates = await db.query(
    \`SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.profile_frame, w.balance
     FROM users u
     JOIN wallets w ON w.user_id = u.id
     WHERE LOWER(BTRIM(u.first_name)) = LOWER('Олеся')
       AND u.merged_into_user_id IS NULL
       AND u.deleted_at IS NULL
     ORDER BY u.id
     LIMIT 2\`
  );
  if (candidates.rowCount !== 1) return null;
  if (userId !== null && String(candidates.rows[0].id) !== String(userId)) return null;
  return candidates.rows[0];
}

async function applyOlesyaGift(db, userId = null) {
  const row = await resolveOlesyaRow(db, userId);
  if (!row) return false;

  if (String(row.profile_frame || '') !== 'olesya') {
    await db.query(
      "UPDATE users SET profile_frame = 'olesya', updated_at = NOW() WHERE id = $1",
      [row.id]
    );
  }

  const grant = await db.query(
    \`INSERT INTO beta_grants (code, user_id, amount)
     VALUES ('olesya-heart-million', $1, 1000000)
     ON CONFLICT (code, user_id) DO NOTHING
     RETURNING user_id\`,
    [row.id]
  );
  if (!grant.rowCount) return true;

  const wallet = await db.query(
    \`UPDATE wallets
     SET balance = balance + 1000000, updated_at = NOW()
     WHERE user_id = $1
     RETURNING balance\`,
    [row.id]
  );
  const balanceAfter = Number(wallet.rows[0]?.balance || Number(row.balance || 0) + 1_000_000);
  await db.query(
    \`INSERT INTO transactions (
       request_key, client_id, mode, status, bonus_spent, bonus_earned,
       balance_after, reason, reward_code, completed_at
     ) VALUES (
       $1, $2, 'adjustment', 'completed', 0, 1000000,
       $3, 'Персональный подарок Олесе — 1 000 000 бонусов',
       'olesya-heart-million', NOW()
     )\`,
    [\`reward:\${row.id}:olesya-heart-million\`, row.id, balanceAfter]
  );
  return true;
}

async function initDatabase() {
  const client = await pool.connect();`
  },
  {
    label: 'применение подарка Олесе при запуске',
    from: `      if (anna.rowCount) await applyBetaUserRules(client, anna.rows[0].id);
    }
    await client.query('COMMIT');`,
    to: `      if (anna.rowCount) await applyBetaUserRules(client, anna.rows[0].id);
    }
    await applyOlesyaGift(client);
    await client.query('COMMIT');`
  },
  {
    label: 'применение подарка Олесе при открытии профиля',
    from: `async function getProfile(userId, db = pool) {
  const userResult = await db.query(`,
    to: `async function getProfile(userId, db = pool) {
  await applyOlesyaGift(db, userId);
  const userResult = await db.query(`
  }
]);

await patchFile('universal-server.js', [
  {
    label: 'идентификатор Олеси в универсальном сервере',
    from: "const annaTelegramId = String(process.env.ANNA_TELEGRAM_ID || '').trim();\nconst vkAppId",
    to: "const annaTelegramId = String(process.env.ANNA_TELEGRAM_ID || '').trim();\nconst olesyaTelegramId = String(process.env.OLESYA_TELEGRAM_ID || '').trim();\nconst vkAppId"
  },
  {
    label: 'сердечная рамка в универсальном профиле',
    from: `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row)) return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  if (storedFrame === 'anna') return 'none';
  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';
}`,
    to: `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row)) return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  if (storedFrame === 'olesya') return 'olesya';
  if (storedFrame === 'anna') return 'none';
  return ['money', 'fire', 'diamond'].includes(storedFrame) ? storedFrame : 'none';
}`
  },
  {
    label: 'доступная рамка Олеси в универсальном профиле',
    from: `function availableFramesFromRow(row) {
  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];
  if (isAnnaRow(row)) return [{ code: 'anna', title: 'Персональная рамка Анны' }];
  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];`,
    to: `function availableFramesFromRow(row) {
  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];
  if (isAnnaRow(row)) return [{ code: 'anna', title: 'Персональная рамка Анны' }];
  if (String(row?.profile_frame || '') === 'olesya') return [{ code: 'olesya', title: 'Рамка из множества сердечек' }];
  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];`
  }
]);

await patchFile('app.js', [
  {
    label: 'версия клиента',
    from: "const APP_VERSION = '17.0-luxury-vip-space';",
    to: "const APP_VERSION = '17.2-olesya-hearts';"
  },
  {
    label: 'класс сердечной рамки',
    from: `  if (entity.profileFrame === 'anna') return 'avatar-frame avatar-frame-anna';
  return '';`,
    to: `  if (entity.profileFrame === 'anna') return 'avatar-frame avatar-frame-anna';
  if (entity.profileFrame === 'olesya') return 'avatar-frame avatar-frame-olesya';
  return '';`
  },
  {
    label: 'сердечки вокруг аватара',
    from: `  if (entity.profileFrame === 'anna') {
    const symbols = [
      '<span class="anna-18">18</span>', '<span class="anna-heart">💔</span>', '<span class="anna-whip">➰</span>', '<span class="anna-cash">$</span>',
      '<span class="anna-18">18</span>', '<span class="anna-heart">💔</span>', '<span class="anna-whip">➰</span>', '<span class="anna-cash">$</span>'
    ];
    return \`<span class="avatar-orbit anna-orbit" aria-hidden="true">\${symbols.map((symbol, index) => \`<i style="--orbit-index:\${index}">\${symbol}</i>\`).join('')}</span>\`;
  }
  return '';`,
    to: `  if (entity.profileFrame === 'anna') {
    const symbols = [
      '<span class="anna-18">18</span>', '<span class="anna-heart">💔</span>', '<span class="anna-whip">➰</span>', '<span class="anna-cash">$</span>',
      '<span class="anna-18">18</span>', '<span class="anna-heart">💔</span>', '<span class="anna-whip">➰</span>', '<span class="anna-cash">$</span>'
    ];
    return \`<span class="avatar-orbit anna-orbit" aria-hidden="true">\${symbols.map((symbol, index) => \`<i style="--orbit-index:\${index}">\${symbol}</i>\`).join('')}</span>\`;
  }
  if (entity.profileFrame === 'olesya') {
    const hearts = ['♥','♡','❤','♥','♡','❤','♥','♡','❤','♥','♡','❤'];
    return \`<span class="avatar-orbit olesya-orbit" aria-hidden="true">\${hearts.map((heart, index) => \`<i style="--orbit-index:\${index}"><span>\${heart}</span></i>\`).join('')}</span>\`;
  }
  return '';`
  },
  {
    label: 'видимая сердечная рамка профиля',
    from: `  element.classList.toggle('has-money-frame', entity.profileFrame === 'money');
  element.classList.toggle('has-anna-frame', entity.profileFrame === 'anna');`,
    to: `  element.classList.toggle('has-money-frame', entity.profileFrame === 'money');
  element.classList.toggle('has-anna-frame', entity.profileFrame === 'anna');
  element.classList.toggle('has-olesya-frame', entity.profileFrame === 'olesya');`
  },
  {
    label: 'автоматическое открытие достижений при загрузке',
    from: "  renderAchievementCatalog();\n  window.setTimeout(maybeShowAchievementCelebration, 120);\n  return state.achievements;",
    to: "  renderAchievementCatalog();\n  return state.achievements;"
  },
  {
    label: 'автоматическое открытие достижений после операции',
    from: "      state.profile = data.client;\n      renderProfile();\n      window.setTimeout(maybeShowAchievementCelebration, 120);\n    }",
    to: "      state.profile = data.client;\n      renderProfile();\n    }"
  },
  {
    label: 'получение достижений без обязательной настройки профиля',
    from: "  if (!state.profile?.onboardingComplete || !state.profile?.termsAccepted) return;",
    to: "  if (!state.profile?.termsAccepted) return;"
  },
  {
    label: 'явное получение достижений',
    from: "document.addEventListener('click', blockUnacceptedAction, true);\n\n$('#openAchievementsButton')?.addEventListener('click', () => openAchievements());",
    to: "document.addEventListener('click', blockUnacceptedAction, true);\n\nfunction openAchievementHub() {\n  if ((state.profile?.unannouncedAchievements || []).length) {\n    maybeShowAchievementCelebration();\n    return;\n  }\n  openAchievements();\n}\n\n$('#openAchievementsButton')?.addEventListener('click', openAchievementHub);"
  },
  {
    label: 'кнопка достижений в профиле',
    from: "$('#openProfileAchievements')?.addEventListener('click', () => openAchievements());",
    to: "$('#openProfileAchievements')?.addEventListener('click', openAchievementHub);"
  }
]);

await patchFile('styles.css', [
  {
    label: 'стили сердечной рамки Олеси',
    from: `@keyframes annaFrameSpin { to { transform: rotate(360deg); } }
@keyframes annaOrbitSpin { to { transform: rotate(360deg); } }
@keyframes annaSymbolUpright { to { transform: rotate(360deg); } }

.shop-list-card {`,
    to: `@keyframes annaFrameSpin { to { transform: rotate(360deg); } }
@keyframes annaOrbitSpin { to { transform: rotate(360deg); } }
@keyframes annaSymbolUpright { to { transform: rotate(360deg); } }

/* Персональная рамка Олеси — множество живых сердечек */
.avatar-frame-olesya,
.profile-avatar.has-olesya-frame,
.profile-avatar.has-olesya-frame .avatar-render-inner {
  overflow: visible !important;
}
.avatar-frame-olesya {
  filter: drop-shadow(0 0 10px rgba(255, 85, 154, .38));
}
.avatar-frame-olesya::before {
  inset: -4px;
  padding: 3px;
  background: conic-gradient(from 10deg, #250814, #8d174a, #ff5d9e, #ffd4e6, #c82468, #671037, #ff8fba, #250814);
  box-shadow: 0 0 15px rgba(255, 76, 145, .42), inset 0 0 9px rgba(255,255,255,.24);
  animation: olesyaFrameSpin 9.6s linear infinite;
}
.avatar-frame-olesya::after {
  inset: -10px;
  border: 1px solid rgba(255, 137, 183, .3);
  background:
    radial-gradient(circle at 50% 50%, transparent 52%, rgba(255, 73, 144, .16) 70%, transparent 82%);
  box-shadow: 0 0 24px rgba(255, 64, 137, .28);
  animation: olesyaFrameGlow 2.2s ease-in-out infinite;
}
.olesya-orbit {
  inset: -20px;
  animation: olesyaOrbitSpin 9.6s linear infinite;
}
.olesya-orbit i {
  --angle: calc(var(--orbit-index) * 30deg);
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1px;
  height: 1px;
  transform: rotate(var(--angle)) translateY(-38px);
  transform-origin: center;
  font-style: normal;
}
.olesya-orbit i span {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin: -9px;
  color: #fff0f7;
  font: 900 15px/1 system-ui, sans-serif;
  text-shadow: 0 0 5px #ff4f94, 0 0 11px rgba(255, 56, 131, .75);
  animation: olesyaHeartPulse 1.7s ease-in-out infinite;
  animation-delay: calc(var(--orbit-index) * -.11s);
}
.olesya-orbit i:nth-child(3n) span {
  color: #ff6fa8;
  font-size: 13px;
}
.olesya-orbit i:nth-child(4n) span {
  color: #ffd0e2;
  font-size: 17px;
}
.profile-avatar .olesya-orbit {
  inset: -24px;
}
.profile-avatar .olesya-orbit i {
  transform: rotate(var(--angle)) translateY(-44px);
}
.profile-avatar .olesya-orbit i span {
  width: 20px;
  height: 20px;
  margin: -10px;
  font-size: 17px;
}
@keyframes olesyaFrameSpin { to { transform: rotate(360deg); } }
@keyframes olesyaOrbitSpin { to { transform: rotate(360deg); } }
@keyframes olesyaFrameGlow {
  0%, 100% { opacity: .55; transform: scale(.98); }
  50% { opacity: 1; transform: scale(1.04); }
}
@keyframes olesyaHeartPulse {
  0%, 100% { opacity: .62; transform: scale(.78); }
  50% { opacity: 1; transform: scale(1.22); }
}
@media (prefers-reduced-motion: reduce) {
  .avatar-frame-olesya::before,
  .avatar-frame-olesya::after,
  .olesya-orbit,
  .olesya-orbit i span {
    animation: none !important;
  }
}

.shop-list-card {`
  }
]);

await patchFile('index.html', [
  {
    label: 'версия таблицы стилей',
    from: '<link rel="stylesheet" href="styles.css?v=17.0-luxury-vip-space" />',
    to: '<link rel="stylesheet" href="styles.css?v=17.2-olesya-hearts" />'
  },
  {
    label: 'версия клиентского файла',
    from: '<script defer src="app.js?v=17.0-luxury-vip-space"></script>',
    to: '<script defer src="app.js?v=17.2-olesya-hearts"></script>'
  },
  {
    label: 'название подарочного литра',
    from: '<h2>15-й литр — в подарок</h2>',
    to: '<h2>Каждый 15-й литр — бесплатно</h2>'
  },
  {
    label: 'условия подарочного литра',
    from: '<p>Оплатите 14 литров разливного — следующий литр бесплатный.</p>',
    to: '<p>Оплатите 14 литров разливного пива — следующий 1 литр бесплатно.</p>'
  },
  {
    label: 'подпись общей статистики литров',
    from: '<small>выпито в Пивнике</small>',
    to: '<small>учтено разливного</small>'
  },
  {
    label: 'заголовок статистики литров',
    from: '<article><span>Выпито за всё время</span><strong><i id="statsTotalLiters">0</i> л</strong></article>',
    to: '<article><span>Учтено разливного за всё время</span><strong><i id="statsTotalLiters">0</i> л</strong></article>'
  },
  {
    label: 'пояснение статистики литров',
    from: '<p class="help-intro">Литры считаются за всё время, а Лига — только по фактически оплаченным покупкам текущего месяца.</p>',
    to: '<p class="help-intro">Учитывается зафиксированный сотрудником объём разливного пива за всё время. Лига считается только по фактически оплаченным покупкам текущего месяца.</p>'
  }
]);

await import('./universal-server.js');
