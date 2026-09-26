import fs from 'node:fs';

const target = new URL('../universal-server.js', import.meta.url);
let source = fs.readFileSync(target, 'utf8');

const importLine = "import { createCustomer360Repository } from './customer-360-repository.js';";
if (!source.includes(importLine)) {
  const anchor = "import { resolvePersonalQrRecord } from './qr-resolver.js';";
  if (!source.includes(anchor)) throw new Error('Customer 360 import anchor not found');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const retentionImportLine = "import { queryRetentionAudiencePreview } from './retention-audience-preview.js';";
if (!source.includes(retentionImportLine)) {
  if (!source.includes(importLine)) throw new Error('Retention preview import anchor not found');
  source = source.replace(importLine, `${importLine}\n${retentionImportLine}`);
}

const repositoryLine = 'const loadCustomer360 = createCustomer360Repository({ query: (...args) => pool.query(...args) });';
if (!source.includes(repositoryLine)) {
  const anchor = "const pool = new Pool({\n  connectionString: databaseUrl,\n  ssl: useSsl ? { rejectUnauthorized: false } : false,\n  max: 8,\n  idleTimeoutMillis: 30_000,\n  connectionTimeoutMillis: 10_000\n});";
  if (!source.includes(anchor)) throw new Error('Customer 360 repository anchor not found');
  source = source.replace(anchor, `${anchor}\n\n${repositoryLine}`);
}

const retentionRouteMarker = "url.pathname === '/api/admin/retention/audience-preview'";
if (!source.includes(retentionRouteMarker)) {
  const anchor = "    if (req.method === 'GET' && url.pathname === '/api/admin/users') {";
  if (!source.includes(anchor)) throw new Error('Retention preview route anchor not found');
  const route = `    if (req.method === 'GET' && url.pathname === '/api/admin/retention/audience-preview') {\n      const user = await requireGatewayUser(req);\n      if (!user.termsAccepted) {\n        return sendJson(res, 428, { error: 'Сначала примите правила программы.' });\n      }\n      if (!['viewer', 'admin'].includes(user.role)) {\n        return sendJson(res, 403, { error: 'Недостаточно прав.' });\n      }\n      try {\n        const preview = await queryRetentionAudiencePreview(pool, url.searchParams.get('segment'));\n        return sendJson(res, 200, preview);\n      } catch (error) {\n        if (error instanceof TypeError) {\n          return sendJson(res, 400, { error: error.message });\n        }\n        throw error;\n      }\n    }\n\n`;
  source = source.replace(anchor, route + anchor);
}

const routeMarker = "url.pathname.match(/^\\/api\\/admin\\/users\\/(\\d+)$/)";
if (!source.includes(routeMarker)) {
  const anchor = "    if (req.method === 'GET' && url.pathname === '/api/admin/users') {";
  if (!source.includes(anchor)) throw new Error('Customer 360 route anchor not found');
  const route = `    if (req.method === 'GET') {\n      const customerMatch = url.pathname.match(/^\\/api\\/admin\\/users\\/(\\d+)$/);\n      if (customerMatch) {\n        const user = await requireGatewayUser(req);\n        if (!user.termsAccepted) {\n          return sendJson(res, 428, { error: 'Сначала примите правила программы.' });\n        }\n        const profile = await getProfile(user.id);\n        if (!profile || !['viewer', 'admin'].includes(profile.role)) {\n          return sendJson(res, 403, { error: 'Недостаточно прав.' });\n        }\n        const customer = await loadCustomer360(customerMatch[1], {\n          historyLimit: url.searchParams.get('historyLimit') || 30\n        });\n        if (!customer) return sendJson(res, 404, { error: 'Пользователь не найден.' });\n        return sendJson(res, 200, customer);\n      }\n    }\n\n`;
  source = source.replace(anchor, route + anchor);
}

fs.writeFileSync(target, source);
console.log('Customer 360 admin API materialized');
