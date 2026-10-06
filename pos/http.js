import { createPosService } from './service.js';
import { createPosDeviceService } from './devices.js';
import { evotorConfig } from './evotor-client.js';
import { posError } from './scope.js';

export function createPosHttp(pool, config = evotorConfig(), clock = Date.now) {
  const sales = createPosService(pool, config), devices = createPosDeviceService(pool, config);
  // Tills are limited per device after the key is checked; failed keys per client address in a
  // separate map, so anonymous traffic can never use up a till's budget.
  const deviceWindows = new Map(), failedWindows = new Map();
  const boundedBody = (body) => {
    if (body && Buffer.byteLength(JSON.stringify(body), 'utf8') > 8192) {
      throw posError(413, 'pos_body_too_large', 'Слишком большой запрос кассы.');
    }
  };
  const tooMany = () => posError(429, 'pos_rate_limit', 'Слишком много запросов кассы. Повторите позже.');
  const windowFor = (windows, key, now) => {
    for (const [stale, entry] of windows) if (entry.until <= now) windows.delete(stale);
    return windows.get(key) || { until: now + 60_000, count: 0 };
  };
  const rateLimit = (deviceId) => {
    const key = String(deviceId), entry = windowFor(deviceWindows, key, clock());
    if (++entry.count > 120) throw tooMany();
    deviceWindows.set(key, entry);
  };
  const failedKey = (address) => String(address || 'unknown').slice(0, 200);
  // Only answers to bad keys are throttled: a valid key is never refused because of them.
  const recordFailure = (address) => {
    const key = failedKey(address), entry = windowFor(failedWindows, key, clock());
    if (!failedWindows.has(key) && failedWindows.size >= 1000) return true;
    failedWindows.set(key, entry);
    return ++entry.count > 30;
  };
  return {
    async device({ method, pathname, authorization, body, address }) {
      const routes = { '/api/device/pos/qr/resolve': 'resolveFor', '/api/device/pos/receipts/bind': 'bindFor' };
      if (method !== 'POST' || !Object.hasOwn(routes, pathname)) throw posError(404, 'pos_route_not_found', 'POS API не найден.');
      boundedBody(body);
      let device;
      try {
        device = await devices.authenticate(authorization);
      } catch (error) {
        if (error.statusCode === 401 && recordFailure(address)) throw tooMany();
        throw error;
      }
      rateLimit(device.id);
      return devices[routes[pathname]](device, body);
    },
    async admin({ method, pathname, user, params = {}, body }) {
      if (!user?.id) throw posError(401, 'unauthorized', 'Требуется авторизация.');
      if (!user.termsAccepted) throw posError(428, 'terms_required', 'Сначала примите правила программы.');
      if (method === 'POST') boundedBody(body);
      if (method === 'GET' && pathname === '/api/admin/pos/dashboard') return sales.dashboard(user, params);
      if (method === 'GET' && pathname === '/api/admin/pos/devices') return devices.list(user, params);
      if (!body || Array.isArray(body) || typeof body !== 'object') throw posError(400, 'invalid_input', 'Нужен JSON-объект.');
      if (method === 'POST' && pathname === '/api/admin/pos/sync') return sales.sync(user, body);
      if (method === 'POST' && pathname === '/api/admin/pos/link') return sales.link(user, body);
      if (method === 'POST' && pathname === '/api/admin/pos/devices') return devices.issue(user, body);
      if (method === 'POST' && pathname === '/api/admin/pos/devices/revoke') return devices.revoke(user, body);
      throw posError(404, 'pos_route_not_found', 'POS API не найден.');
    }
  };
}
