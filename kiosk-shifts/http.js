import { MAX_PHOTO_BYTES, httpError } from './service.js';

const PREFIX = '/api/kiosk/v1';
const MAX_JSON_BYTES = 16 * 1024;
const AUTH_SCHEME = 'KioskShift ';

function send(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

async function readBody(req, maxBytes) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > maxBytes) throw httpError(413, 'Слишком большой запрос.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw httpError(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buffer = await readBody(req, MAX_JSON_BYTES);
  if (!buffer.length) return {};
  try {
    const value = JSON.parse(buffer.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    throw httpError(400, 'Некорректный JSON.');
  }
}

export function createKioskShiftHttpHandler({ service, enabled, enforceRateLimit, requestAddress }) {
  const limit = (key, count, windowMs) => enforceRateLimit(`kiosk-shift:${key}`, count, windowMs);

  async function requireDevice(req) {
    const raw = String(req.headers.authorization || '');
    const token = raw.startsWith(AUTH_SCHEME) ? raw.slice(AUTH_SCHEME.length).trim() : '';
    if (!token) throw httpError(401, 'Телефон не подключён к системе смен.', { code: 'device_not_enrolled' });
    const device = await service.authenticate(token);
    if (!device) throw httpError(401, 'Ключ телефона недействителен. Подключите телефон заново.', { code: 'device_not_enrolled' });
    return device;
  }

  async function route(req, res, url) {
    const method = String(req.method || 'GET').toUpperCase();
    const path = url.pathname.slice(PREFIX.length) || '/';

    if (method === 'POST' && path === '/enroll') {
      limit(`enroll:${requestAddress(req)}`, 10, 10 * 60 * 1000);
      const body = await readJson(req);
      return send(res, 201, await service.enrollDevice({ code: body.code, label: body.label }));
    }

    const device = await requireDevice(req);
    limit(`device:${device.id}`, 240, 60 * 1000);

    if (method === 'GET' && path === '/status') {
      return send(res, 200, { ok: true, device: { id: device.public_id, label: device.label }, configuration: service.configuration() });
    }
    if (method === 'GET' && path === '/shifts') {
      return send(res, 200, await service.listShifts(device, url.searchParams.get('limit')));
    }
    if (method === 'POST' && path === '/shifts') {
      return send(res, 200, await service.startShift(device, await readJson(req)));
    }

    const shiftMatch = path.match(/^\/shifts\/([0-9a-f-]{36})(\/.*)?$/);
    if (!shiftMatch) throw httpError(404, 'Не найдено.');
    const [, shiftId, rest = ''] = shiftMatch;

    if (method === 'GET' && rest === '') return send(res, 200, await service.getShift(device, shiftId));
    if (method === 'POST' && rest === '/close') {
      return send(res, 200, await service.closeShift(device, shiftId, await readJson(req)));
    }
    const photoMatch = rest.match(/^\/documents\/(report|receipt|invoice)\/photos\/([0-9a-f-]{36})$/);
    if (method === 'PUT' && photoMatch) {
      limit(`upload:${device.id}`, 60, 60 * 1000);
      const data = await readBody(req, MAX_PHOTO_BYTES);
      return send(res, 201, await service.storePhoto(device, shiftId, photoMatch[1], photoMatch[2], data));
    }
    const submitMatch = rest.match(/^\/documents\/(report|receipt|invoice)\/submit$/);
    if (method === 'POST' && submitMatch) {
      limit(`submit:${device.id}`, 12, 60 * 1000);
      const body = await readJson(req);
      return send(res, 200, await service.submitDocument(device, shiftId, submitMatch[1], body.photoIds));
    }
    throw httpError(404, 'Не найдено.');
  }

  return async function handleKioskShiftRequest(req, res, url) {
    try {
      if (!enabled) return send(res, 404, { error: 'Система смен не включена.', code: 'disabled' });
      if (!(await service.schemaReady())) {
        return send(res, 503, { error: 'Система смен ещё не подготовлена на сервере.', code: 'schema_not_ready', retryable: true });
      }
      return await route(req, res, url);
    } catch (error) {
      const statusCode = Number(error?.statusCode || 500);
      if (statusCode >= 500 && !error?.statusCode) console.error('kiosk shift request failed:', error?.code || error?.message || 'unknown');
      if (res.headersSent) return res.end();
      return send(res, statusCode, {
        error: error?.statusCode ? error.message : 'Внутренняя ошибка сервера.',
        ...(error?.code && typeof error.code === 'string' && error.statusCode ? { code: error.code } : {}),
        ...(error?.retryable !== undefined ? { retryable: Boolean(error.retryable) } : { retryable: statusCode >= 500 || statusCode === 429 })
      });
    }
  };
}

export const KIOSK_SHIFT_PATH_PREFIX = '/api/kiosk/';
