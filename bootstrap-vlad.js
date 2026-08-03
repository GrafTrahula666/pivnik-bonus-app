import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const bootstrapPath = path.join(__dirname, 'bootstrap.js');

let content = await fs.readFile(bootstrapPath, 'utf8');
let changed = false;

function replaceOnce(from, to, label) {
  if (content.includes(to)) return;
  if (!content.includes(from)) {
    throw new Error(`Не найден фрагмент для рамки Владислава: ${label}`);
  }
  content = content.replace(from, to);
  changed = true;
}

replaceOnce(
  "  }\n]);\n\nawait patchFile('universal-server.js', [",
  `  },
  {
    label: 'идентификатор Владислава',
    from: "const olesyaTelegramId = String(process.env.OLESYA_TELEGRAM_ID || '').trim();\\nconst appleWalletIssuerUrl",
    to: "const olesyaTelegramId = String(process.env.OLESYA_TELEGRAM_ID || '').trim();\\nconst vladislavTelegramId = String(process.env.VLADISLAV_TELEGRAM_ID || '').trim();\\nconst appleWalletIssuerUrl"
  },
  {
    label: 'рамка Владислава в профиле сервера',
    from: "  if (storedFrame === 'olesya') return 'olesya';\\n  if (storedFrame === 'anna') return 'none';",
    to: "  if (storedFrame === 'olesya') return 'olesya';\\n  if (storedFrame === 'vladislav') return 'vladislav';\\n  if (storedFrame === 'anna') return 'none';"
  },
  {
    label: 'доступная рамка Владислава на сервере',
    from: "  if (String(row?.profile_frame || '') === 'olesya') return [{ code: 'olesya', title: 'Рамка из множества сердечек' }];\\n  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];",
    to: "  if (String(row?.profile_frame || '') === 'olesya') return [{ code: 'olesya', title: 'Рамка из множества сердечек' }];\\n  if (String(row?.profile_frame || '') === 'vladislav') return [{ code: 'vladislav', title: 'Рамка из 12 пульсирующих какашек' }];\\n  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];"
  },
  {
    label: 'привязка персональной рамки Владислава',
    from: "async function initDatabase() {\\n  const client = await pool.connect();",
    to: "async function resolveVladislavRow(db, userId = null) {\\n  if (vladislavTelegramId) {\\n    const exact = await db.query(\\n      \\\"SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.profile_frame FROM users u WHERE u.telegram_id::text = $1 AND u.role = 'staff' AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL LIMIT 1\\\",\\n      [vladislavTelegramId]\\n    );\\n    if (!exact.rowCount) return null;\\n    if (userId !== null && String(exact.rows[0].id) !== String(userId)) return null;\\n    return exact.rows[0];\\n  }\\n\\n  const candidates = await db.query(\\n    \\\"SELECT u.id, u.telegram_id, u.first_name, u.last_name, u.profile_frame FROM users u WHERE u.role = 'staff' AND LOWER(BTRIM(u.first_name)) IN (LOWER('Владислав'), LOWER('Влад'), LOWER('Vladislav'), LOWER('Vlad')) AND u.merged_into_user_id IS NULL AND u.deleted_at IS NULL ORDER BY u.id LIMIT 2\\\"\\n  );\\n  if (candidates.rowCount !== 1) return null;\\n  if (userId !== null && String(candidates.rows[0].id) !== String(userId)) return null;\\n  return candidates.rows[0];\\n}\\n\\nasync function applyVladislavFrame(db, userId = null) {\\n  const row = await resolveVladislavRow(db, userId);\\n  if (!row) return false;\\n  if (String(row.profile_frame || '') !== 'vladislav') {\\n    await db.query(\\n      \\\"UPDATE users SET profile_frame = 'vladislav', updated_at = NOW() WHERE id = $1\\\",\\n      [row.id]\\n    );\\n  }\\n  return true;\\n}\\n\\nasync function initDatabase() {\\n  const client = await pool.connect();"
  },
  {
    label: 'установка рамки Владислава при запуске',
    from: "    await applyOlesyaGift(client);\\n    await client.query('COMMIT');",
    to: "    await applyOlesyaGift(client);\\n    await applyVladislavFrame(client);\\n    await client.query('COMMIT');"
  },
  {
    label: 'установка рамки Владислава при открытии профиля',
    from: "  await applyOlesyaGift(db, userId);\\n  const userResult = await db.query(",
    to: "  await applyOlesyaGift(db, userId);\\n  await applyVladislavFrame(db, userId);\\n  const userResult = await db.query("
  }
]);

await patchFile('universal-server.js', [`,
  'серверные правила'
);

replaceOnce(
  "  }\n]);\n\nawait patchFile('app.js', [",
  `  },
  {
    label: 'идентификатор Владислава в универсальном сервере',
    from: "const olesyaTelegramId = String(process.env.OLESYA_TELEGRAM_ID || '').trim();\\nconst vkAppId",
    to: "const olesyaTelegramId = String(process.env.OLESYA_TELEGRAM_ID || '').trim();\\nconst vladislavTelegramId = String(process.env.VLADISLAV_TELEGRAM_ID || '').trim();\\nconst vkAppId"
  },
  {
    label: 'рамка Владислава в универсальном профиле',
    from: "  if (storedFrame === 'olesya') return 'olesya';\\n  if (storedFrame === 'anna') return 'none';",
    to: "  if (storedFrame === 'olesya') return 'olesya';\\n  if (storedFrame === 'vladislav') return 'vladislav';\\n  if (storedFrame === 'anna') return 'none';"
  },
  {
    label: 'доступная рамка Владислава в универсальном профиле',
    from: "  if (String(row?.profile_frame || '') === 'olesya') return [{ code: 'olesya', title: 'Рамка из множества сердечек' }];\\n  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];",
    to: "  if (String(row?.profile_frame || '') === 'olesya') return [{ code: 'olesya', title: 'Рамка из множества сердечек' }];\\n  if (String(row?.profile_frame || '') === 'vladislav') return [{ code: 'vladislav', title: 'Рамка из 12 пульсирующих какашек' }];\\n  if (row?.role === 'viewer') return [{ code: 'fire', title: 'Огненная рамка' }];"
  }
]);

await patchFile('app.js', [`,
  'универсальный профиль'
);

replaceOnce(
  "  }\n]);\n\nawait patchFile('styles.css', [",
  `  },
  {
    label: 'версия клиента с рамкой Владислава',
    from: "const APP_VERSION = '17.2-olesya-hearts';",
    to: "const APP_VERSION = '17.3-vlad-poops';"
  },
  {
    label: 'класс рамки Владислава',
    from: "  if (entity.profileFrame === 'olesya') return 'avatar-frame avatar-frame-olesya';\\n  return '';",
    to: "  if (entity.profileFrame === 'olesya') return 'avatar-frame avatar-frame-olesya';\\n  if (entity.profileFrame === 'vladislav') return 'avatar-frame avatar-frame-vladislav';\\n  return '';"
  },
  {
    label: '12 какашек вокруг аватара Владислава',
    from: "  }\\n  return '';\\n}\\n\\nfunction avatarInlineHtml",
    to: "  }\\n  if (entity.profileFrame === 'vladislav') {\\n    const poops = Array.from({ length: 12 }, () => '💩');\\n    return '<span class=\\\"avatar-orbit vladislav-orbit\\\" aria-hidden=\\\"true\\\">' + poops.map((poop, index) => '<i style=\\\"--orbit-index:' + index + ';--counter-angle:' + (-index * 30) + 'deg\\\"><span>' + poop + '</span></i>').join('') + '</span>';\\n  }\\n  return '';\\n}\\n\\nfunction avatarInlineHtml"
  },
  {
    label: 'видимая рамка Владислава в профиле',
    from: "  element.classList.toggle('has-olesya-frame', entity.profileFrame === 'olesya');",
    to: "  element.classList.toggle('has-olesya-frame', entity.profileFrame === 'olesya');\\n  element.classList.toggle('has-vladislav-frame', entity.profileFrame === 'vladislav');"
  }
]);

await patchFile('styles.css', [`,
  'клиентская логика рамки'
);

replaceOnce(
  "  }\n]);\n\nawait patchFile('index.html', [",
  `  },
  {
    label: 'стили рамки Владислава из какашек',
    from: "@media (prefers-reduced-motion: reduce) {\\n  .avatar-frame-olesya::before,\\n  .avatar-frame-olesya::after,\\n  .olesya-orbit,\\n  .olesya-orbit i span {\\n    animation: none !important;\\n  }\\n}\\n\\n.shop-list-card {",
    to: "@media (prefers-reduced-motion: reduce) {\\n  .avatar-frame-olesya::before,\\n  .avatar-frame-olesya::after,\\n  .olesya-orbit,\\n  .olesya-orbit i span {\\n    animation: none !important;\\n  }\\n}\\n\\n/* Персональная рамка бармена Владислава — 12 пульсирующих какашек */\\n.avatar-frame-vladislav,\\n.profile-avatar.has-vladislav-frame,\\n.profile-avatar.has-vladislav-frame .avatar-render-inner {\\n  overflow: visible !important;\\n}\\n.avatar-frame-vladislav {\\n  filter: drop-shadow(0 0 9px rgba(181, 112, 53, .42));\\n}\\n.avatar-frame-vladislav::before {\\n  inset: -4px;\\n  padding: 3px;\\n  background: conic-gradient(from 0deg, #24140a, #6f3e1d, #b8783d, #f0bf72, #6a3517, #d49a55, #2a160b);\\n  box-shadow: 0 0 14px rgba(190, 119, 57, .42), inset 0 0 8px rgba(255,239,202,.2);\\n  animation: vladislavFrameGlow 2.1s ease-in-out infinite;\\n}\\n.avatar-frame-vladislav::after {\\n  inset: -10px;\\n  border: 1px solid rgba(226, 157, 88, .3);\\n  background: radial-gradient(circle, transparent 54%, rgba(133, 74, 30, .18) 72%, transparent 82%);\\n  box-shadow: 0 0 21px rgba(155, 88, 37, .28);\\n  animation: vladislavFrameGlow 2.1s ease-in-out infinite reverse;\\n}\\n.vladislav-orbit {\\n  inset: -20px;\\n}\\n.vladislav-orbit i {\\n  --angle: calc(var(--orbit-index) * 30deg);\\n  position: absolute;\\n  left: 50%;\\n  top: 50%;\\n  width: 1px;\\n  height: 1px;\\n  transform: rotate(var(--angle)) translateY(-38px);\\n  transform-origin: center;\\n  font-style: normal;\\n}\\n.vladislav-orbit i span {\\n  display: grid;\\n  place-items: center;\\n  width: 20px;\\n  height: 20px;\\n  margin: -10px;\\n  font: 900 17px/1 system-ui, sans-serif;\\n  transform: rotate(var(--counter-angle));\\n  scale: .78;\\n  filter: drop-shadow(0 0 4px rgba(230, 164, 87, .52));\\n  animation: vladislavPoopPulse 1.35s ease-in-out infinite;\\n  animation-delay: calc(var(--orbit-index) * -.085s);\\n}\\n.profile-avatar .vladislav-orbit {\\n  inset: -24px;\\n}\\n.profile-avatar .vladislav-orbit i {\\n  transform: rotate(var(--angle)) translateY(-44px);\\n}\\n.profile-avatar .vladislav-orbit i span {\\n  width: 22px;\\n  height: 22px;\\n  margin: -11px;\\n  font-size: 19px;\\n}\\n@keyframes vladislavPoopPulse {\\n  0%, 100% { opacity: .62; scale: .76; filter: drop-shadow(0 0 3px rgba(230,164,87,.35)); }\\n  50% { opacity: 1; scale: 1.24; filter: drop-shadow(0 0 9px rgba(243,183,104,.88)); }\\n}\\n@keyframes vladislavFrameGlow {\\n  0%, 100% { opacity: .58; transform: scale(.985); }\\n  50% { opacity: 1; transform: scale(1.035); }\\n}\\n@media (prefers-reduced-motion: reduce) {\\n  .avatar-frame-vladislav::before,\\n  .avatar-frame-vladislav::after,\\n  .vladislav-orbit i span {\\n    animation: none !important;\\n  }\\n}\\n\\n.shop-list-card {"
  }
]);

await patchFile('index.html', [`,
  'стили рамки'
);

replaceOnce(
  "  }\n]);\n\nawait import('./universal-server.js');",
  `  },
  {
    label: 'версия стилей Владислава',
    from: '<link rel="stylesheet" href="styles.css?v=17.2-olesya-hearts" />',
    to: '<link rel="stylesheet" href="styles.css?v=17.3-vlad-poops" />'
  },
  {
    label: 'версия клиента Владислава',
    from: '<script defer src="app.js?v=17.2-olesya-hearts"></script>',
    to: '<script defer src="app.js?v=17.3-vlad-poops"></script>'
  }
]);

await import('./universal-server.js');`,
  'обновление кэша'
);

if (changed) await fs.writeFile(bootstrapPath, content, 'utf8');
await import('./bootstrap.js');
