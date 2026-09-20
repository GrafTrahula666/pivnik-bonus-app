import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(root, 'universal-server.js');
let source = await fs.readFile(serverPath, 'utf8');

const importLine = "import { createCustomer360Repository } from './customer-360-repository.js';";
if (!source.includes(importLine)) {
  const anchor = "import { adminUserCrmStatus, queryAdminUserDirectory } from './admin-user-directory.js';";
  if (!source.includes(anchor)) throw new Error('Customer 360 API import anchor is missing');
  source = source.replace(anchor, `${anchor}\n${importLine}`);
}

const repositoryLine = "const loadCustomer360 = createCustomer360Repository({ query: pool.query.bind(pool) });";
if (!source.includes(repositoryLine)) {
  const anchor = "const sessionSecret = crypto";
  if (!source.includes(anchor)) throw new Error('Customer 360 repository anchor is missing');
  source = source.replace(anchor, `${repositoryLine}\n\n${anchor}`);
}

const routeMarker = "const customer360Match = url.pathname.match(/^\\/api\\/admin\\/users\\/(\\d+)$/);";
if (!source.includes(routeMarker)) {
  const listRoute = "    if (req.method === 'GET' && url.pathname === '/api/admin/users') {";
  if (!source.includes(listRoute)) throw new Error('Admin user directory route anchor is missing');
  const route = `    if (req.method === 'GET') {\n      const customer360Match = url.pathname.match(/^\\/api\\/admin\\/users\\/(\\d+)$/);\n      if (customer360Match) {\n        const user = await requireGatewayUser(req);\n        if (!user.termsAccepted) {\n          return sendJson(res, 428, { error: 'Сначала примите правила программы.' });\n        }\n        const profile = await getProfile(user.id);\n        if (!profile || !['viewer', 'admin'].includes(profile.role)) {\n          return sendJson(res, 403, { error: 'Недостаточно прав.' });\n        }\n        const customer = await loadCustomer360(customer360Match[1]);\n        if (!customer) return sendJson(res, 404, { error: 'Клиент не найден.' });\n        return sendJson(res, 200, { customer });\n      }\n    }\n\n`;
  source = source.replace(listRoute, `${route}${listRoute}`);
}

await fs.writeFile(serverPath, source);
console.log('SPACEVERSE Customer 360 admin API materialized.');
