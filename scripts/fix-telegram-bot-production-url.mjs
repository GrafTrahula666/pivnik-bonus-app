import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'server.js');
const canonicalTelegramUrl = 'https://pivnik-bonus-app-production.up.railway.app';

let source = await fs.readFile(serverPath, 'utf8');

const oldUrlBlock = `const telegramWebAppUrl = String(
  process.env.TELEGRAM_WEBAPP_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? \`https://\${process.env.RAILWAY_PUBLIC_DOMAIN}\` : '')
    || 'https://pivnik-bonus-app-production.up.railway.app'
).replace(/\\/+$/, '');`;

const fixedUrlBlock = `const telegramWebAppUrl = '${canonicalTelegramUrl}';`;

if (source.includes(oldUrlBlock)) {
  source = source.replace(oldUrlBlock, fixedUrlBlock);
} else if (!source.includes(fixedUrlBlock)) {
  throw new Error('Не найден блок telegramWebAppUrl для исправления production URL.');
}

const staleWebhookGuard = `  const webhookInfo = await telegramBotApi('getWebhookInfo');
  const existingWebhook = String(webhookInfo?.url || '').trim();

  if (existingWebhook && existingWebhook !== webhookUrl) {
    console.warn('Telegram webhook already points to another service; keeping it unchanged:', existingWebhook);
    return;
  }

`;

if (source.includes(staleWebhookGuard)) {
  source = source.replace(staleWebhookGuard, '');
}

await fs.writeFile(serverPath, source, 'utf8');
console.log('Telegram bot URL forced to canonical production domain and webhook will be refreshed.');
