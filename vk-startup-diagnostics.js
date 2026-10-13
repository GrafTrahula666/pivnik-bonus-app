import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

// Temporary startup diagnostics: only enumerated fields may reach logs.
// Client observations are labelled explicitly; they are never auth evidence.
export const VK_STARTUP_EVENTS = new Set([
  'VK_BOOT_START', 'VK_PLATFORM_READY', 'VK_BRIDGE_AVAILABLE', 'VK_BRIDGE_UNAVAILABLE',
  'VK_BRIDGE_INIT_START', 'VK_BRIDGE_INIT_OK', 'VK_BRIDGE_INIT_TIMEOUT', 'VK_BRIDGE_INIT_FAIL',
  'VK_LAUNCH_PARAMS_URL_PRESENT', 'VK_LAUNCH_PARAMS_BRIDGE_PRESENT', 'VK_LAUNCH_PARAMS_MISSING',
  'VK_LAUNCH_PARAMS_VALID', 'VK_AUTH_START', 'VK_AUTH_STATUS', 'VK_AUTH_SUCCESS', 'VK_AUTH_FAIL',
  'VK_SESSION_RECEIVED', 'VK_SESSION_REJECTED', 'VK_PROFILE_REQUEST_START', 'VK_PROFILE_SUCCESS',
  'VK_PROFILE_FAIL', 'VK_BOOT_COMPLETE', 'VK_BOOT_FAIL', 'VK_BOOT_STALLED', 'VK_CLIENT_ERROR',
  'VK_SIGNATURE_START', 'VK_SIGNATURE_OK', 'VK_DB_CONNECT_START', 'VK_DB_CONNECT_OK',
  'VK_ACCOUNT_LOOKUP_START', 'VK_ACCOUNT_LOOKUP_OK', 'VK_ACCOUNT_WRITE_START', 'VK_ACCOUNT_WRITE_OK',
  'VK_SESSION_CREATE_START', 'VK_SESSION_CREATED', 'VK_PROFILE_ASSEMBLY_START', 'VK_PROFILE_ASSEMBLY_OK'
]);
const SAFE_CODES = new Set([
  'NONE', 'TIMEOUT', 'NETWORK', 'HTTP_401', 'HTTP_403', 'HTTP_429', 'HTTP_500', 'HTTP_502', 'HTTP_503',
  'HTTP_ERROR', 'INVALID_RESPONSE', 'EXPIRED_LAUNCH', 'INVALID_SIGNATURE', 'IDENTITY_MISMATCH',
  'BRIDGE_UNAVAILABLE', 'BRIDGE_FAILURE', 'DB_TIMEOUT', 'DB_UNAVAILABLE', 'NOT_READY', 'UNKNOWN'
]);
export function validBootId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value) ? value : null;
}
export function safeStartupCode(error) {
  if (error?.message === 'Ссылка запуска VK устарела. Откройте приложение повторно.') return 'EXPIRED_LAUNCH';
  if (error?.message === 'Подпись запуска VK недействительна.') return 'INVALID_SIGNATURE';
  if (error?.message === 'Данные профиля VK не совпадают с подписью запуска.') return 'IDENTITY_MISMATCH';
  if (['57014', '55P03', 'ETIMEDOUT'].includes(error?.code)) return 'DB_TIMEOUT';
  if (['ECONNREFUSED', '08006', '53300', '57P03'].includes(error?.code)) return 'DB_UNAVAILABLE';
  const status = Number(error?.statusCode || error?.status || 0);
  if (status) return SAFE_CODES.has(`HTTP_${status}`) ? `HTTP_${status}` : 'HTTP_ERROR';
  return SAFE_CODES.has(error?.code) ? error.code : 'UNKNOWN';
}
function boundedInt(value, max) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
}
export function sanitizeStartupBatch(payload) {
  const bootId = validBootId(payload?.bootId);
  if (!bootId || !Array.isArray(payload?.events) || payload.events.length > 24) return [];
  return payload.events.filter((entry) => VK_STARTUP_EVENTS.has(entry?.event)).map((entry) => ({
    source: 'client', platform: 'vk', bootId, event: entry.event,
    attempt: boundedInt(entry.attempt, 1000), elapsedMs: boundedInt(entry.elapsedMs, 86_400_000),
    timestamp: Number.isSafeInteger(entry.timestamp) && entry.timestamp > 0 && entry.timestamp < 9e12
      ? new Date(entry.timestamp).toISOString() : null,
    status: boundedInt(entry.status, 599),
    code: SAFE_CODES.has(entry.code) ? entry.code : 'UNKNOWN'
  }));
}
const context = new AsyncLocalStorage();
export function withVkStartupTrace(trace, action) { return context.run(trace, action); }
export function traceVkStage(event, details = {}) { context.getStore()?.(event, details); }
export function createVkStartupTrace(bootId, releaseCommit, write = console.info) {
  if (!validBootId(bootId)) return () => {};
  const started = Date.now();
  const requestId = randomUUID();
  return (event, details = {}) => {
    if (!VK_STARTUP_EVENTS.has(event)) return;
    try {
      write(JSON.stringify({
        source: 'server', platform: 'vk', bootId, requestId, event, releaseCommit,
        timestamp: new Date().toISOString(), elapsedMs: Date.now() - started,
        status: boundedInt(details.status, 599),
        code: SAFE_CODES.has(details.code) ? details.code : 'NONE'
      }));
    } catch { /* diagnostics must never change the auth result */ }
  };
}
