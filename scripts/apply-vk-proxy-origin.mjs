import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, '..', 'universal-server.js');

const source = await fs.readFile(serverPath, 'utf8');
const marker = 'VK proxy exact-origin allowlist';

if (source.includes(marker)) {
  console.log('VK proxy origin allowlist already applied.');
  process.exit(0);
}

const before = `function enforceMutationOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') {
    throw Object.assign(new Error('Запрос с постороннего сайта отклонён.'), { statusCode: 403 });
  }
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    if (originUrl.host !== expectedHost) {
      throw Object.assign(new Error('Источник запроса не совпадает с приложением.'), {
        statusCode: 403
      });
    }
  } catch (error) {
    if (error?.statusCode) throw error;
    throw Object.assign(new Error('Некорректный источник запроса.'), { statusCode: 403 });
  }
}`;

const after = `function enforceMutationOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method || '').toUpperCase())) return;
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  const origin = String(req.headers.origin || '');
  const allowedOrigins = new Set(
    String(process.env.PIVNIK_ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
  // VK proxy exact-origin allowlist: only explicitly configured HTTPS origins may bypass
  // the host-equality check. Generic cross-site requests remain rejected.
  if (fetchSite === 'cross-site' && !allowedOrigins.has(origin)) {
    throw Object.assign(new Error('Запрос с постороннего сайта отклонён.'), { statusCode: 403 });
  }
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const originAllowed = originUrl.protocol === 'https:' && allowedOrigins.has(originUrl.origin);
    if (originUrl.host !== expectedHost && !originAllowed) {
      throw Object.assign(new Error('Источник запроса не совпадает с приложением.'), {
        statusCode: 403
      });
    }
  } catch (error) {
    if (error?.statusCode) throw error;
    throw Object.assign(new Error('Некорректный источник запроса.'), { statusCode: 403 });
  }
}`;

if (!source.includes(before)) {
  throw new Error('Could not locate enforceMutationOrigin block; refusing to patch unknown runtime.');
}

await fs.writeFile(serverPath, source.replace(before, after), 'utf8');
console.log('Applied exact VK proxy origin allowlist.');
