import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  await fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, from, to, marker, label) {
  if (source.includes(marker)) return source;
  if (!source.includes(from)) {
    throw new Error(`Не найден фрагмент platform-separation: ${label}`);
  }
  return source.replace(from, to);
}

let gateway = await read('universal-server.js');

gateway = replaceRequired(
  gateway,
  `async function getIdentitySummary(db, userId) {`,
  `const PLATFORM_ACCOUNT_MODE = 'separate';\n\nasync function getIdentitySummary(db, userId) {`,
  `const PLATFORM_ACCOUNT_MODE = 'separate';`,
  'маркер режима отдельных аккаунтов'
);

gateway = replaceRequired(
  gateway,
  `  return {\n    identities,\n    linkedPlatforms: identities.map((item) => item.provider),\n    accountLinked: identities.some((item) => item.provider === 'telegram')\n      && identities.some((item) => item.provider === 'vk')\n  };`,
  `  const legacyLinked = identities.some((item) => item.provider === 'telegram')\n    && identities.some((item) => item.provider === 'vk');\n  return {\n    identities,\n    linkedPlatforms: identities.map((item) => item.provider),\n    accountLinked: false,\n    legacyLinked\n  };`,
  `legacyLinked\n  };`,
  'статус архивной связки'
);

gateway = replaceRequired(
  gateway,
  `        linkedPlatforms: ['telegram', 'vk'].includes(platform) ? [platform] : [],\n        accountLinked: false\n      }`,
  `        linkedPlatforms: ['telegram', 'vk'].includes(platform) ? [platform] : [],\n        accountLinked: false,\n        legacyLinked: false\n      }`,
  `legacyLinked: false\n      }`,
  'startup-профиль отдельных аккаунтов'
);

gateway = replaceRequired(
  gateway,
  `    if (!userId && isOwner && provider === 'vk' && ownerTelegramId) {\n      const owner = await client.query(\n        'SELECT id FROM users WHERE telegram_id::text = $1 FOR UPDATE',\n        [ownerTelegramId]\n      );\n      if (owner.rowCount) userId = await canonicalUserId(client, owner.rows[0].id);\n    }\n\n`,
  `    // VK and Telegram identities are intentionally independent, including the owner.\n\n`,
  `VK and Telegram identities are intentionally independent`,
  'автоматическое объединение владельца'
);

gateway = replaceRequired(
  gateway,
  `      return sendJson(res, 200, {\n        ...health,\n        ok: true,\n        unifiedAccounts: true,\n        ...publicReleaseMetadata()\n      });`,
  `      return sendJson(res, 200, {\n        ...health,\n        ok: true,\n        unifiedAccounts: false,\n        accountMode: PLATFORM_ACCOUNT_MODE,\n        ...publicReleaseMetadata()\n      });`,
  `unifiedAccounts: false,\n        accountMode: PLATFORM_ACCOUNT_MODE,\n        ...publicReleaseMetadata()`,
  'health режим аккаунтов'
);

gateway = replaceRequired(
  gateway,
  `        unifiedAccounts: true,\n        linkCodes: true,\n        bar: BAR_CODE,`,
  `        unifiedAccounts: false,\n        linkCodes: false,\n        accountMode: PLATFORM_ACCOUNT_MODE,\n        bar: BAR_CODE,`,
  `linkCodes: false,\n        accountMode: PLATFORM_ACCOUNT_MODE,\n        bar: BAR_CODE,`,
  'platform-health режим аккаунтов'
);

gateway = replaceRequired(
  gateway,
  `    if (req.method === 'GET' && url.pathname === '/api/account-link/status') {`,
  `    if (url.pathname.startsWith('/api/account-link/')) {\n      const user = await requireGatewayUser(req);\n      const platform = platformFromRequest(req, user.payload.platform || 'unknown');\n      return sendJson(res, 410, {\n        error: 'VK и Telegram работают как отдельные аккаунты. Объединение отключено.',\n        disabled: true,\n        accountMode: PLATFORM_ACCOUNT_MODE,\n        platform\n      });\n    }\n\n    if (req.method === 'GET' && url.pathname === '/api/account-link/status') {`,
  `VK и Telegram работают как отдельные аккаунты. Объединение отключено.`,
  'отключение API объединения'
);

gateway = gateway.replace(
  `    console.log('Unified Telegram/VK account schema is ready.');`,
  `    console.log('Separate Telegram/VK account mode is ready.');`
);

await write('universal-server.js', gateway);

let accountLink = await read('account-link.js');
accountLink = replaceRequired(
  accountLink,
  `    const paragraphCopy = 'Программа предназначена для пользователей 18+. Для работы используются идентификаторы привязанных аккаунтов VK и Telegram, имя, бонусный баланс и история операций.';`,
  `    const paragraphCopy = 'Программа предназначена для пользователей 18+. В VK и Telegram создаются отдельные профили со своим балансом, историей операций и QR-кодом.';`,
  `В VK и Telegram создаются отдельные профили`,
  'текст согласия об отдельных профилях'
);
accountLink = replaceRequired(
  accountLink,
  `    const listCopy = 'После привязки в VK и Telegram отображается один и тот же постоянный QR-код.';`,
  `    const listCopy = 'Профили VK и Telegram не объединяются; общим остаётся только соревнование в Лиге Пивника.';`,
  `общим остаётся только соревнование в Лиге Пивника`,
  'текст согласия о лиге'
);
accountLink = replaceRequired(
  accountLink,
  `  document.addEventListener('DOMContentLoaded', () => {\n    injectInterface();\n    installAchievementInbox();\n    // Consent is action-gated by app.js. Do not watch or rewrite the whole DOM:\n    // observer callbacks that mutate the observed tree can starve the boot loop.\n    updateConsentCopy();\n\n    const loadAfterBoot = () => window.setTimeout(() => void loadStatus(), 0);\n    const bootScreen = document.getElementById('bootScreen');\n    if (bootScreen?.classList.contains('hidden')) loadAfterBoot();\n    else window.addEventListener('pivnik:boot-complete', loadAfterBoot, { once: true });\n  });`,
  `  document.addEventListener('DOMContentLoaded', () => {\n    installAchievementInbox();\n    // Account linking is intentionally unavailable: VK and Telegram are separate profiles.\n    updateConsentCopy();\n  });`,
  `Account linking is intentionally unavailable`,
  'отключение интерфейса объединения'
);
await write('account-link.js', accountLink);

let app = await read('app.js');
app = replaceRequired(
  app,
  `  root.className = \`operation-list\${users.length ? '' : ' empty-state'}\`;\n  root.innerHTML = users.length ? users.map((user) => {\n    const controls =`,
  `  root.className = \`operation-list\${users.length ? '' : ' empty-state'}\`;\n  const normalizeAdminIdentity = (value) => String(value || '')\n    .toLowerCase()\n    .replace(/^@/, '')\n    .replace(/[^a-zа-яё0-9]/gi, '');\n  const identityForMatch = (user) => ({\n    username: normalizeAdminIdentity(user.username),\n    name: normalizeAdminIdentity(user.name)\n  });\n  const sameApproximateIdentity = (left, right) => {\n    const a = identityForMatch(left);\n    const b = identityForMatch(right);\n    const usernameMatch = a.username.length >= 4 && a.username === b.username;\n    const nameMatch = a.name.length >= 6 && (\n      a.name === b.name\n      || a.name.includes(b.name)\n      || b.name.includes(a.name)\n    );\n    return usernameMatch || nameMatch;\n  };\n  root.innerHTML = users.length ? users.map((user) => {\n    const platformDetails = [\n      user.telegramId ? \`Telegram \${user.telegramId}\` : '',\n      user.vkId ? \`VK \${user.vkId}\` : ''\n    ].filter(Boolean).join(' · ') || 'ID не указан';\n    const legacyLinked = Boolean(user.telegramId && user.vkId);\n    const possibleMatch = legacyLinked ? null : users.find((candidate) => {\n      if (String(candidate.id) === String(user.id)) return false;\n      if (candidate.telegramId && candidate.vkId) return false;\n      const differentPlatforms = Boolean(user.telegramId) !== Boolean(candidate.telegramId);\n      return differentPlatforms && sameApproximateIdentity(user, candidate);\n    });\n    const possibleMatchNote = possibleMatch\n      ? \`<br><span class="user-pin-state">Возможное совпадение: \${escapeHtml(possibleMatch.name || possibleMatch.username || possibleMatch.id)} · только подсказка, без объединения</span>\`\n      : '';\n    const controls =`,
  `Возможное совпадение:`,
  'подсказки совпадений в админке'
);
app = replaceRequired(
  app,
  `      <div><b>\${escapeHtml(user.name)}</b><small>\${escapeHtml(user.telegramId ? \`Telegram \${user.telegramId}\` : user.vkId ? \`VK \${user.vkId}\` : 'ID не указан')}\${user.username ? \` · @\${escapeHtml(user.username)}\` : ''}<br>\${escapeHtml(user.qrShortCode || 'QR не создан')} · пиво \${fmtLiters(user.beerPaidLitersTotal)} л · подарок \${fmtLiters(user.beerGiftLitersBalance)} л\${user.role === 'staff' ? \`<br><span class="user-pin-state">\${user.pinConfigured ? 'PIN настроен' : 'PIN не задан'}</span>\` : ''}</small></div>`,
  `      <div><b>\${escapeHtml(user.name)}</b><small>\${escapeHtml(platformDetails)}\${legacyLinked ? ' · архивная связка' : ''}\${user.username ? \` · @\${escapeHtml(user.username)}\` : ''}<br>\${escapeHtml(user.qrShortCode || 'QR не создан')} · пиво \${fmtLiters(user.beerPaidLitersTotal)} л · подарок \${fmtLiters(user.beerGiftLitersBalance)} л\${possibleMatchNote}\${user.role === 'staff' ? \`<br><span class="user-pin-state">\${user.pinConfigured ? 'PIN настроен' : 'PIN не задан'}</span>\` : ''}</small></div>`,
  `архивная связка`,
  'платформы в списке пользователей'
);
await write('app.js', app);

const verification = await Promise.all([
  read('universal-server.js'),
  read('account-link.js'),
  read('app.js')
]);
const failures = [];
if (!verification[0].includes(`const PLATFORM_ACCOUNT_MODE = 'separate';`)) failures.push('server mode marker');
if (verification[0].includes(`if (!userId && isOwner && provider === 'vk' && ownerTelegramId)`)) failures.push('owner auto-link');
if (!verification[0].includes(`linkCodes: false`)) failures.push('link API health');
if (!verification[1].includes('Account linking is intentionally unavailable')) failures.push('link UI');
if (!verification[2].includes('Возможное совпадение:')) failures.push('admin possible matches');
if (failures.length) throw new Error(`Разделение платформ не завершено: ${failures.join(', ')}`);

console.log('VK and Telegram account separation is applied and verified.');