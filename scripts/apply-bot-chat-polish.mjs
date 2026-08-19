import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
const marker = '// V20 · Telegram bot chat polish';

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Не найден фрагмент для Telegram bot polish: ${label}`);
  return source.replace(from, to);
}

function replacePatternRequired(source, pattern, replacement, markerText, label) {
  if (source.includes(markerText)) return source;
  if (!pattern.test(source)) throw new Error(`Не найден фрагмент для Telegram bot polish: ${label}`);
  return source.replace(pattern, replacement);
}

let source = await fs.readFile(serverPath, 'utf8');
if (source.includes(marker)) {
  console.log('Telegram bot chat polish already applied.');
  process.exit(0);
}

source = replaceRequired(
  source,
  "const isChildServer = process.env.PIVNIK_CHILD_SERVER === '1';",
  `const isChildServer = process.env.PIVNIK_CHILD_SERVER === '1';\n${marker}\nconst telegramRuntimePlatform = String(process.env.PIVNIK_DOCUMENT_PLATFORM || '').trim().toLowerCase();\nconst telegramRailwayServiceName = String(process.env.RAILWAY_SERVICE_NAME || '').trim().toLowerCase();\nconst telegramWebAppUrl = String(\n  process.env.TELEGRAM_WEBAPP_URL\n    || (process.env.RAILWAY_PUBLIC_DOMAIN ? \`https://\${process.env.RAILWAY_PUBLIC_DOMAIN}\` : '')\n    || 'https://pivnik-bonus-app-production.up.railway.app'\n).replace(/\\/+$/, '');\nconst telegramBotUiEnabled = Boolean(\n  botToken\n  && isChildServer\n  && telegramRuntimePlatform !== 'vk'\n  && !telegramRailwayServiceName.includes('vk')\n);\nconst telegramWebhookSecret = crypto\n  .createHash('sha256')\n  .update(\`pivnik-telegram-webhook:\${process.env.SESSION_SECRET || botToken || 'local'}\`)\n  .digest('hex');`,
  'Telegram runtime constants'
);

source = replacePatternRequired(
  source,
  /async function sendTelegramMessage\(telegramId, text\) \{[\s\S]*?\n\}\n\nfunction transactionResponse/,
  `function formatTelegramRubles(cents) {\n  return \`\${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(rubles(cents))} ₽\`;\n}\n\nfunction formatTelegramLiters(ml) {\n  return \`\${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(litersFromMl(ml))} л\`;\n}\n\nfunction telegramAppKeyboard() {\n  return {\n    inline_keyboard: [[{\n      text: 'Открыть ПИВНИК | Бонусы',\n      web_app: { url: telegramWebAppUrl }\n    }]]\n  };\n}\n\nasync function telegramBotApi(method, payload = {}) {\n  if (!botToken) return null;\n  const response = await fetch(\`https://api.telegram.org/bot\${botToken}/\${method}\`, {\n    method: 'POST',\n    headers: { 'content-type': 'application/json' },\n    body: JSON.stringify(payload)\n  });\n  const data = await response.json().catch(() => null);\n  if (!response.ok || data?.ok === false) {\n    const description = data?.description || \`HTTP \${response.status}\`;\n    throw new Error(\`Telegram \${method} failed: \${description}\`);\n  }\n  return data?.result ?? null;\n}\n\nasync function sendTelegramMessage(telegramId, text, extra = {}) {\n  if (!botToken || !telegramId) return null;\n  try {\n    return await telegramBotApi('sendMessage', { chat_id: telegramId, text, ...extra });\n  } catch (error) {\n    console.error('Telegram sendMessage error:', error.message);\n    return null;\n  }\n}\n\nasync function configureTelegramBotUi() {\n  if (!telegramBotUiEnabled || !telegramWebAppUrl) return;\n\n  await telegramBotApi('setChatMenuButton', {\n    menu_button: {\n      type: 'web_app',\n      text: 'Открыть ПИВНИК',\n      web_app: { url: telegramWebAppUrl }\n    }\n  });\n\n  const webhookUrl = \`\${telegramWebAppUrl}/telegram/webhook\`;\n  const webhookInfo = await telegramBotApi('getWebhookInfo');\n  const existingWebhook = String(webhookInfo?.url || '').trim();\n\n  if (existingWebhook && existingWebhook !== webhookUrl) {\n    console.warn('Telegram webhook already points to another service; keeping it unchanged:', existingWebhook);\n    return;\n  }\n\n  await telegramBotApi('setWebhook', {\n    url: webhookUrl,\n    secret_token: telegramWebhookSecret,\n    allowed_updates: ['message'],\n    drop_pending_updates: false\n  });\n\n  await telegramBotApi('setMyCommands', {\n    commands: [\n      { command: 'app', description: 'Открыть ПИВНИК | Бонусы' },\n      { command: 'help', description: 'Помощь по приложению' },\n      { command: 'privacy', description: 'Правила и конфиденциальность' }\n    ]\n  });\n}\n\nasync function handleTelegramBotUpdate(update) {\n  const message = update?.message;\n  if (!message || message.chat?.type !== 'private') return;\n  const rawText = String(message.text || '').trim();\n  if (!rawText.startsWith('/')) return;\n  const command = rawText.split(/\\s+/)[0].split('@')[0].toLowerCase();\n  const chatId = message.chat.id;\n\n  if (command === '/start' || command === '/app') {\n    await sendTelegramMessage(\n      chatId,\n      'ПИВНИК | Бонусы\\n\\nЛичный кабинет программы лояльности. Здесь приходят уведомления о бонусах, подарках и операциях.\\n\\nОткройте приложение кнопкой ниже.',\n      { reply_markup: telegramAppKeyboard() }\n    );\n    return;\n  }\n\n  if (command === '/help') {\n    await sendTelegramMessage(\n      chatId,\n      'Помощь по ПИВНИК | Бонусы\\n\\nБаланс, личный QR, история операций, Лига, достижения и Колесо находятся внутри приложения. Подробные правила: Профиль → Правила и помощь.',\n      { reply_markup: telegramAppKeyboard() }\n    );\n    return;\n  }\n\n  if (command === '/privacy') {\n    await sendTelegramMessage(\n      chatId,\n      'Правила и конфиденциальность\\n\\nДокументы программы, настройки конфиденциальности и удаление аккаунта доступны внутри приложения в разделе «Профиль».',\n      { reply_markup: telegramAppKeyboard() }\n    );\n  }\n}\n\nfunction transactionResponse`,
  'async function configureTelegramBotUi()',
  'Telegram Bot API helpers'
);

source = replacePatternRequired(
  source,
  /const beerText = beerMl > 0[\s\S]*?await sendTelegramMessage\(\n\s*targetUser\.telegram_id,\n\s*`Операция в баре «Пивник»[\s\S]*?обратитесь к администратору\.`\n\s*\);/,
  `const beerText = beerMl > 0\n      ? \`\\nРазливное: \${formatTelegramLiters(beerMl)}\${beerGiftEarnedMl ? \`\\nПодарок начислен: \${formatTelegramLiters(beerGiftEarnedMl)}\` : ''}\`\n      : '';\n    const operationTitle = mode === 'redeem' ? '🎟 ПИВНИК · Списание' : '✅ ПИВНИК · Начисление';\n    const operationText = mode === 'redeem'\n      ? \`Списано: −\${bonusSpent} Б\\nНачислено: +\${bonusEarned} Б\${beerText}\`\n      : \`Начислено: +\${bonusEarned} Б\${beerText}\`;\n    await sendTelegramMessage(\n      targetUser.telegram_id,\n      \`\${operationTitle}\\n\\nЧек: \${formatTelegramRubles(amountCents)}\\n\${operationText}\\nК оплате: \${formatTelegramRubles(cashPaidCents)}\\n\\nБаланс: \${hasUnlimitedBonus(targetUser) ? '∞' : balanceAfter} Б\\n\\nНе ваша операция? Сообщите администратору.\`\n    );`,
  "const operationTitle = mode === 'redeem' ? '🎟 ПИВНИК · Списание'",
  'customer operation notification'
);

source = replacePatternRequired(
  source,
  /`⚠️ Подозрительная операция свыше 3000 ₽\n\nКлиент: \$\{clientName \|\| targetUser\.telegram_id\}\nСотрудник: \$\{actingStaff\.firstName\}\nТип: \$\{mode === 'redeem' \? 'списание' : 'начисление'\}\nЧек: \$\{rubles\(amountCents\)\.toFixed\(2\)\} ₽`/,
  "`⚠️ ПИВНИК · Требует внимания\\n\\nЧек: ${formatTelegramRubles(amountCents)}\\nКлиент: ${clientName || targetUser.telegram_id}\\nСотрудник: ${actingStaff.firstName}\\nОперация: ${mode === 'redeem' ? 'Списание' : 'Начисление'}`",
  '⚠️ ПИВНИК · Требует внимания',
  'owner suspicious notification'
);

source = replacePatternRequired(
  source,
  /`Подарок в баре «Пивник»\n\nВыдано бесплатно: \$\{litersFromMl\(giftMl\)\} л разливного пива\.\nОсталось подарочного объёма: \$\{litersFromMl\(newGiftBalance\)\} л\.`/,
  "`🍺 ПИВНИК · Подарок\\n\\nВыдано: ${formatTelegramLiters(giftMl)} разливного пива\\nОсталось подарочного объёма: ${formatTelegramLiters(newGiftBalance)}`",
  '🍺 ПИВНИК · Подарок',
  'beer gift notification'
);

source = replacePatternRequired(
  source,
  /`Покупка в лавке «Пивника»\n\n\$\{item\.title\}\nСписано: \$\{item\.bonusPrice\} бонусов\nБаланс: \$\{balanceAfter\} бонусов`/,
  "`🛍 ПИВНИК · Покупка\\n\\n${item.title}\\nСписано: −${item.bonusPrice} Б\\nБаланс: ${balanceAfter} Б`",
  '🛍 ПИВНИК · Покупка',
  'shop notification'
);

source = replacePatternRequired(
  source,
  /`Операция в баре «Пивник» отменена\.\nПричина: \$\{reason\}\nТекущий баланс: \$\{profile\.balance\} бонусов\.`/g,
  "`↩️ ПИВНИК · Операция отменена\\n\\nПричина: ${reason}\\nБаланс: ${profile.unlimitedBonus ? '∞' : profile.balance} Б`",
  '↩️ ПИВНИК · Операция отменена',
  'staff cancellation notification'
);

source = source.replace(
  /`Операция в баре «Пивник» отменена владельцем\.\nПричина: \$\{reason\}\nТекущий баланс: \$\{profile\.balance\} бонусов\.`/g,
  "`↩️ ПИВНИК · Операция отменена владельцем\\n\\nПричина: ${reason}\\nБаланс: ${profile.unlimitedBonus ? '∞' : profile.balance} Б`"
);

source = replaceRequired(
  source,
  "app.get('/styles.css', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'styles.css')));",
  `app.post('/telegram/webhook', (req, res) => {\n  if (!telegramBotUiEnabled) return res.sendStatus(404);\n  const suppliedSecret = String(req.get('x-telegram-bot-api-secret-token') || '');\n  const suppliedBuffer = Buffer.from(suppliedSecret);\n  const expectedBuffer = Buffer.from(telegramWebhookSecret);\n  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {\n    return res.sendStatus(403);\n  }\n  res.sendStatus(200);\n  void handleTelegramBotUpdate(req.body).catch((error) => {\n    console.error('Telegram webhook handling error:', error.message);\n  });\n});\n\napp.get('/styles.css', (_req, res) => res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'styles.css')));`,
  'Telegram webhook route'
);

source = replaceRequired(
  source,
  "const server = app.listen(port, isChildServer ? '127.0.0.1' : '0.0.0.0', () => {\n  console.log(`Pivnik app is running on port ${port}`);\n});",
  `const server = app.listen(port, isChildServer ? '127.0.0.1' : '0.0.0.0', () => {\n  console.log(\`Pivnik app is running on port \${port}\`);\n  void configureTelegramBotUi().catch((error) => {\n    console.error('Telegram bot UI configuration error:', error.message);\n  });\n});`,
  'Telegram bot startup configuration'
);

await fs.writeFile(serverPath, source, 'utf8');
console.log('Applied Telegram bot chat polish.');
