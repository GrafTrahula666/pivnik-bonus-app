import crypto from 'node:crypto';
import { NotConfiguredError } from './telegram.js';

// One shift = one row. Column A holds the shift id so writes are idempotent
// upserts (re-sending the same shift updates its row instead of adding one).
export const SHEET_HEADER = Object.freeze([
  'ID смены', 'Дата', 'Сотрудник', 'Время открытия', 'Опоздание', 'Время закрытия',
  'Наличных в кассе при открытии', 'Итого наличных', 'Итого переводов', 'Общая выручка',
  'Наличных в кассе при закрытии', 'Зарплата', 'Расходы на бар',
  'Статус отчёта', 'Статус чека', 'Статус смены', 'Комментарий проверяющего'
]);

const LAST_COLUMN = String.fromCharCode('A'.charCodeAt(0) + SHEET_HEADER.length - 1);

const STATUS_TEXT = { missing: 'не сдан', pending: 'на проверке', rejected: 'не принят', accepted: 'принят' };
const SHIFT_TEXT = { open: 'открыта', closed: 'закрыта', left_unclosed: 'не закрыта' };

// Written verbatim as recognized. RAW input mode keeps "=..." as plain text.
export function shiftToSheetRow(shift) {
  const f = shift.report_fields || {};
  return [
    shift.public_id,
    shift.opened_local_date_display || '',
    shift.employee_name || '',
    shift.opened_local_time || '',
    shift.late ? 'да' : 'нет',
    shift.closed_local_time || '',
    f.cash_open || '',
    f.cash_total || '',
    f.transfer_total || '',
    f.revenue_total || '',
    f.cash_close || '',
    f.salary || '',
    f.bar_expenses || '',
    STATUS_TEXT[shift.report_status] || shift.report_status || '',
    STATUS_TEXT[shift.receipt_status] || shift.receipt_status || '',
    SHIFT_TEXT[shift.status] || shift.status || '',
    f.inspector_comment || ''
  ].map((value) => String(value));
}

export function parseServiceAccount(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const json = text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  if (!parsed.client_email || !parsed.private_key) throw new Error('service account JSON lacks client_email/private_key');
  return parsed;
}

export function createGoogleSheetsAdapter({ serviceAccountJson, spreadsheetId, sheetName = 'Смены', fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 20_000 }) {
  let account = null;
  let configError = null;
  try { account = parseServiceAccount(serviceAccountJson); } catch (error) { configError = error; }
  const configured = Boolean(account && spreadsheetId && sheetName);
  let cachedToken = null;

  async function accessToken() {
    if (cachedToken && cachedToken.expiresAt - 60_000 > now()) return cachedToken.value;
    const iat = Math.floor(now() / 1000);
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: account.token_uri || 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600
    })}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
    const response = await fetchImpl(account.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new Error(`Google token request failed: HTTP ${response.status}`);
    cachedToken = { value: payload.access_token, expiresAt: now() + Number(payload.expires_in || 3600) * 1000 };
    return cachedToken.value;
  }

  async function sheetsRequest(method, suffix, body) {
    const token = await accessToken();
    const response = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/${suffix}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Google Sheets ${method} failed: HTTP ${response.status}`);
    return payload;
  }

  const range = (cells) => encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!${cells}`);

  async function upsertShiftRow(shift) {
    if (!configured) throw new NotConfiguredError(configError ? `Google Sheets misconfigured: ${configError.message}` : 'Google Sheets is not configured');
    const row = shiftToSheetRow(shift);
    const existing = await sheetsRequest('GET', `values/${range('A:A')}?majorDimension=COLUMNS`);
    const ids = existing.values?.[0] || [];
    if (!ids.length) {
      await sheetsRequest('PUT', `values/${range(`A1:${LAST_COLUMN}1`)}?valueInputOption=RAW`, { values: [SHEET_HEADER] });
    }
    const index = ids.indexOf(row[0]);
    if (index >= 1) {
      const rowNumber = index + 1;
      await sheetsRequest('PUT', `values/${range(`A${rowNumber}:${LAST_COLUMN}${rowNumber}`)}?valueInputOption=RAW`, { values: [row] });
      return { updatedRow: rowNumber };
    }
    await sheetsRequest('POST', `values/${range(`A:${LAST_COLUMN}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: [row] });
    return { appended: true };
  }

  return { configured, upsertShiftRow };
}
