import { createPosService } from './service.js';
import { createPosDeviceService } from './devices.js';
import { evotorConfig } from './evotor-client.js';
import { posError } from './scope.js';

export function createPosHttp(pool, config = evotorConfig(), clock = Date.now) {
  const sales = createPosService(pool, config), devices = createPosDeviceService(pool, config);
  const windows = new Map();
  const boundedBody = (body) => {
    if (body && Buffer.byteLength(JSON.stringify(body), 'utf8') > 8192) {
      throw posError(413, 'pos_body_too_large', 'Слишком большой запрос кассы.');
    }
  };
  const rateLimit = (address) => {
    const now = clock();
    for (const [key, entry] of windows) if (entry.until <= now) windows.delete(key);
    const key = String(address || 'unknown').slice(0, 200);
    const entry = windows.get(key) || { until: now + 60_000, count: 0 };
    if ((!windows.has(key) && windows.size >= 1000) || ++entry.count > 120) {
      throw posError(429, 'pos_rate_limit', 'Слишком много запросов кассы. Повторите позже.');
    }
    windows.set(key, entry);
  };
  return {
    async device({ method, pathname, authorization, body, address }) {
      const routes = { '/api/device/pos/qr/resolve': devices.resolve, '/api/device/pos/receipts/bind': devices.bind };
      if (method !== 'POST' || !Object.hasOwn(routes, pathname)) throw posError(404, 'pos_route_not_found', 'POS API не найден.');
      rateLimit(address);
      boundedBody(body);
      return routes[pathname](authorization, body);
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
