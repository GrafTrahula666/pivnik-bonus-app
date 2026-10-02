import crypto from 'node:crypto';
import { createOpenAiVisionClient } from './ai.js';
import { createKioskShiftHttpHandler } from './http.js';
export { KIOSK_SHIFT_PATH_PREFIX } from './http.js';
import { createKioskShiftService } from './service.js';
import { createGoogleSheetsAdapter } from './sheets.js';
import { createTelegramNotifier } from './telegram.js';

// All secrets come from the server environment only; the APK never holds any.
//   PIVNIK_KIOSK_SHIFTS=true                feature switch (off by default)
//   KIOSK_SHIFT_ENROLL_CODE                 one-time phone connection code (>= 12 chars)
//   KIOSK_SHIFT_MAX_DEVICES                 active phones allowed (default 3)
//   OPENAI_API_KEY, OPENAI_VISION_MODEL     document checks
//   KIOSK_SHIFT_SKIP_AI_CHECK=true          accept documents without the AI check
//   KIOSK_SHIFT_TELEGRAM_BOT_TOKEN          owners' chat bot (falls back to TELEGRAM_BOT_TOKEN)
//   KIOSK_SHIFT_TELEGRAM_CHAT_ID            owners' chat
//   GOOGLE_SERVICE_ACCOUNT_JSON             raw or base64 service-account JSON
//   GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SHEETS_SHIFT_SHEET (default "Смены")
export function kioskShiftConfigFromEnv(env = process.env) {
  return {
    enabled: String(env.PIVNIK_KIOSK_SHIFTS || '').toLowerCase() === 'true',
    enrollCode: String(env.KIOSK_SHIFT_ENROLL_CODE || '').trim(),
    maxDevices: Math.max(1, Math.min(20, Number(env.KIOSK_SHIFT_MAX_DEVICES || 3) || 3)),
    openAiApiKey: String(env.OPENAI_API_KEY || '').trim(),
    openAiModel: String(env.OPENAI_VISION_MODEL || 'gpt-5').trim(),
    skipAiCheck: String(env.KIOSK_SHIFT_SKIP_AI_CHECK || '').toLowerCase() === 'true',
    telegramBotToken: String(env.KIOSK_SHIFT_TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || '').trim(),
    telegramChatId: String(env.KIOSK_SHIFT_TELEGRAM_CHAT_ID || '').trim(),
    googleServiceAccountJson: String(env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim(),
    googleSpreadsheetId: String(env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim(),
    googleSheetName: String(env.GOOGLE_SHEETS_SHIFT_SHEET || 'Смены').trim()
  };
}

export function createKioskShiftGateway({ pool, sessionSecret, env = process.env, enforceRateLimit, requestAddress, fetchImpl = globalThis.fetch, startWorker = true }) {
  const config = kioskShiftConfigFromEnv(env);
  const pepper = crypto.createHmac('sha256', sessionSecret).update('pivnik:kiosk-shifts:v1').digest();
  const service = createKioskShiftService({
    pool,
    pepper,
    enrollCode: config.enrollCode,
    maxDevices: config.maxDevices,
    ai: createOpenAiVisionClient({ apiKey: config.openAiApiKey, model: config.openAiModel, fetchImpl }),
    skipAiCheck: config.skipAiCheck,
    telegram: createTelegramNotifier({ botToken: config.telegramBotToken, chatId: config.telegramChatId, fetchImpl }),
    sheets: createGoogleSheetsAdapter({
      serviceAccountJson: config.googleServiceAccountJson,
      spreadsheetId: config.googleSpreadsheetId,
      sheetName: config.googleSheetName,
      fetchImpl
    })
  });
  const handler = createKioskShiftHttpHandler({ service, enabled: config.enabled, enforceRateLimit, requestAddress });
  if (config.enabled && startWorker) {
    const timer = setInterval(() => { service.kickOutbox(); }, 60_000);
    timer.unref?.();
  }
  return { handler, service, config };
}
