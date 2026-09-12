const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const serviceName = String(process.env.RAILWAY_SERVICE_NAME || '').toLowerCase();
const documentPlatform = String(process.env.PIVNIK_DOCUMENT_PLATFORM || '').toLowerCase();
const isVkService = documentPlatform === 'vk' || serviceName.includes('vk');
const appUrl = String(process.env.TELEGRAM_APP_URL || process.env.PIVNIK_APP_URL || '').trim().replace(/\/+$/, '');

async function telegramApi(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(`Telegram ${method} failed: ${body?.description || `HTTP ${response.status}`}`);
  }
  return body.result;
}

if (!isVkService && botToken && /^https:\/\//i.test(appUrl)) {
  try {
    await telegramApi('deleteWebhook', { drop_pending_updates: false });
    await telegramApi('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: 'Открыть ПРИЛОЖЕНИЕ',
        web_app: { url: appUrl }
      }
    });
    await telegramApi('deleteMyCommands', {});
    console.log(`Telegram bot menu repaired: ${appUrl}`);
  } catch (error) {
    console.error(`Telegram bot menu repair failed; application startup will continue: ${error?.message || error}`);
  }
} else if (!isVkService && botToken) {
  console.log('Telegram menu repair skipped because TELEGRAM_APP_URL/PIVNIK_APP_URL is not explicitly configured.');
} else {
  console.log('Telegram menu repair skipped for non-Telegram runtime or missing token.');
}
