import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');

function semanticHardeningAlreadyApplied(source, label) {
  if (label === 'database-aware health endpoint') {
    return source.includes("url.pathname === '/api/health'")
      && source.includes('databaseFingerprint')
      && source.includes('publicReleaseMetadata()');
  }
  if (label === 'release readiness endpoint') {
    return source.includes("url.pathname === '/api/release-readiness'")
      && source.includes('legalConfigured')
      && source.includes('identityTombstoneSecretConfigured')
      && source.includes('publicReleaseMetadata()');
  }
  if (label === 'release readiness consent exemption') {
    return source.includes("pathname === '/api/release-readiness'");
  }
  if (label === 'legal template routes') {
    return source.includes("serveLegalDocument(res, path.join(__dirname, 'legal', 'privacy.html'))")
      && source.includes("serveLegalDocument(res, path.join(__dirname, 'legal', 'terms.html'))");
  }
  if (label === 'database fingerprint initialization') {
    return source.includes('await initPlatformDatabase();\n      await refreshDatabaseFingerprint();');
  }
  return false;
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to) || semanticHardeningAlreadyApplied(source, label)) return source;
  if (!source.includes(from)) {
    throw new Error(`Не найден production-hardening фрагмент: ${label}`);
  }
  return source.replace(from, to);
}

let gateway = await fs.readFile(gatewayPath, 'utf8');

gateway = replaceRequired(
  gateway,
  "const configuredSessionSecret = String(process.env.SESSION_SECRET || '');",
  `const configuredSessionSecret = String(process.env.SESSION_SECRET || '');
const configuredIdentityTombstoneSecret = String(process.env.IDENTITY_TOMBSTONE_SECRET || '');
const legalOperatorName = String(process.env.LEGAL_OPERATOR_NAME || '').trim();
const legalOperatorId = String(process.env.LEGAL_OPERATOR_ID || '').trim();
const legalContactEmail = String(process.env.LEGAL_CONTACT_EMAIL || '').trim();
const legalOperatorAddress = String(process.env.LEGAL_OPERATOR_ADDRESS || '').trim();
const legalDataRetentionPolicy = String(process.env.LEGAL_DATA_RETENTION_POLICY || '').trim();
const releaseCommit = String(
  process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || process.env.SOURCE_VERSION
    || 'unknown'
).trim();`,
  'production environment constants'
);

gateway = replaceRequired(
  gateway,
  `if (process.env.NODE_ENV === 'production' && configuredSessionSecret.length < 32) {
  console.error('SESSION_SECRET must contain at least 32 characters in production.');
  process.exit(1);
}`,
  `if (process.env.NODE_ENV === 'production' && configuredSessionSecret.length < 32) {
  console.error('SESSION_SECRET must contain at least 32 characters in production.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && configuredIdentityTombstoneSecret.length < 32) {
  console.error('IDENTITY_TOMBSTONE_SECRET must contain at least 32 characters in production.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  const missingLegalFields = [
    ['LEGAL_OPERATOR_NAME', legalOperatorName],
    ['LEGAL_OPERATOR_ID', legalOperatorId],
    ['LEGAL_CONTACT_EMAIL', legalContactEmail],
    ['LEGAL_OPERATOR_ADDRESS', legalOperatorAddress],
    ['LEGAL_DATA_RETENTION_POLICY', legalDataRetentionPolicy]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missingLegalFields.length) {
    console.error(\`Missing required production legal settings: \${missingLegalFields.join(', ')}\`);
    process.exit(1);
  }
}`,
  'production secret and legal guards'
);

gateway = replaceRequired(
  gateway,
  `const sessionSecret = crypto
  .createHash('sha256')
  .update(configuredSessionSecret || \`pivnik:\${telegramBotToken || 'local-development'}\`)
  .digest();`,
  `const sessionSecret = crypto
  .createHash('sha256')
  .update(configuredSessionSecret || \`pivnik:\${telegramBotToken || 'local-development'}\`)
  .digest();

const identityTombstoneSecret = crypto
  .createHash('sha256')
  .update(
    configuredIdentityTombstoneSecret
      || \`pivnik-tombstone-development:\${configuredSessionSecret || telegramBotToken || 'local'}\`
  )
  .digest();`,
  'separate identity tombstone secret'
);

gateway = replaceRequired(
  gateway,
  `.createHmac('sha256', sessionSecret)
    .update(\`deleted-identity:\${provider}:\${providerUserId}\`)`,
  `.createHmac('sha256', identityTombstoneSecret)
    .update(\`deleted-identity:\${provider}:\${providerUserId}\`)`,
  'tombstone HMAC key separation'
);

gateway = replaceRequired(
  gateway,
  `let platformReady = false;
let childReady = false;
let shuttingDown = false;
const rateLimitBuckets = new Map();`,
  `let platformReady = false;
let childReady = false;
let shuttingDown = false;
let databaseFingerprint = null;
const rateLimitBuckets = new Map();

function publicReleaseMetadata() {
  return {
    databaseFingerprint,
    releaseCommit,
    termsVersion: TERMS_VERSION,
    environment: process.env.NODE_ENV || 'development'
  };
}

async function refreshDatabaseFingerprint() {
  const result = await pool.query(
    'SELECT database_instance_id FROM runtime_identity WHERE singleton = TRUE LIMIT 1'
  );
  const databaseInstanceId = String(result.rows[0]?.database_instance_id || '');
  if (!databaseInstanceId) {
    throw new Error('Runtime database identity is missing.');
  }
  databaseFingerprint = crypto
    .createHash('sha256')
    .update(databaseInstanceId)
    .digest('hex')
    .slice(0, 20);
  return databaseFingerprint;
}`,
  'database fingerprint state'
);

gateway = replaceRequired(
  gateway,
  `async function serveFile(res, filePath, contentType, cacheControl = 'no-store') {
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Файл не найден.' });
  }
}`,
  `async function serveFile(res, filePath, contentType, cacheControl = 'no-store') {
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': body.length,
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Файл не найден.' });
  }
}

async function serveLegalDocument(res, filePath) {
  try {
    const template = await fs.readFile(filePath, 'utf8');
    const replacements = {
      '{{LEGAL_OPERATOR_NAME}}': legalOperatorName || 'Оператор не настроен',
      '{{LEGAL_OPERATOR_ID}}': legalOperatorId || 'не настроено',
      '{{LEGAL_CONTACT_EMAIL}}': legalContactEmail || 'не настроено',
      '{{LEGAL_OPERATOR_ADDRESS}}': legalOperatorAddress || BAR_ADDRESS,
      '{{LEGAL_DATA_RETENTION_POLICY}}': legalDataRetentionPolicy || 'не настроено'
    };
    const html = Object.entries(replacements).reduce(
      (result, [token, value]) => result.replaceAll(token, safeText(value, 1000, 'не настроено')),
      template
    );
    const body = Buffer.from(html);
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: 'Документ не найден.' });
  }
}`,
  'dynamic legal document rendering'
);

gateway = replaceRequired(
  gateway,
  `  return pathname === '/api/health'
    || pathname === '/api/platform-health'`,
  `  return pathname === '/api/health'
    || pathname === '/api/platform-health'
    || pathname === '/api/release-readiness'`,
  'release readiness consent exemption'
);

gateway = replaceRequired(
  gateway,
  `    if (req.method === 'GET' && url.pathname === '/legal/privacy') {
      return serveFile(res, path.join(__dirname, 'legal', 'privacy.html'), 'text/html; charset=utf-8');
    }

    if (req.method === 'GET' && url.pathname === '/legal/terms') {
      return serveFile(res, path.join(__dirname, 'legal', 'terms.html'), 'text/html; charset=utf-8');
    }`,
  `    if (req.method === 'GET' && url.pathname === '/legal/privacy') {
      return serveLegalDocument(res, path.join(__dirname, 'legal', 'privacy.html'));
    }

    if (req.method === 'GET' && url.pathname === '/legal/terms') {
      return serveLegalDocument(res, path.join(__dirname, 'legal', 'terms.html'));
    }`,
  'legal template routes'
);

gateway = replaceRequired(
  gateway,
  `    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (!childReady || !platformReady) {
        return sendJson(res, 503, {
          ok: false,
          database: childReady ? 'initializing' : 'unavailable',
          unifiedAccounts: platformReady
        });
      }
      const upstreamHealth = await fetch(\`http://127.0.0.1:\${internalPort}/api/health\`, {
        signal: AbortSignal.timeout(3000)
      });
      const health = await upstreamHealth.json().catch(() => ({}));
      if (!upstreamHealth.ok) {
        return sendJson(res, 503, {
          ok: false,
          database: 'error',
          unifiedAccounts: true
        });
      }
      return sendJson(res, 200, { ...health, ok: true, unifiedAccounts: true });
    }`,
  `    if (req.method === 'GET' && url.pathname === '/api/health') {
      if (!childReady || !platformReady || !databaseFingerprint) {
        return sendJson(res, 503, {
          ok: false,
          database: childReady ? 'initializing' : 'unavailable',
          unifiedAccounts: platformReady,
          ...publicReleaseMetadata()
        });
      }
      const upstreamHealth = await fetch(\`http://127.0.0.1:\${internalPort}/api/health\`, {
        signal: AbortSignal.timeout(3000)
      });
      const health = await upstreamHealth.json().catch(() => ({}));
      if (!upstreamHealth.ok) {
        return sendJson(res, 503, {
          ok: false,
          database: 'error',
          unifiedAccounts: true,
          ...publicReleaseMetadata()
        });
      }
      return sendJson(res, 200, {
        ...health,
        ok: true,
        unifiedAccounts: true,
        ...publicReleaseMetadata()
      });
    }`,
  'database-aware health endpoint'
);

gateway = replaceRequired(
  gateway,
  `    if (req.method === 'GET' && url.pathname === '/api/platform-health') {
      return sendJson(res, platformReady ? 200 : 503, {
        ok: platformReady,
        telegram: Boolean(telegramBotToken),
        vk: Boolean(vkAppId && vkAppSecret),
        unifiedAccounts: true,
        linkCodes: true,
        bar: BAR_CODE,
        timestamp: new Date().toISOString()
      });
    }`,
  `    if (req.method === 'GET' && url.pathname === '/api/platform-health') {
      const ok = platformReady && Boolean(databaseFingerprint);
      return sendJson(res, ok ? 200 : 503, {
        ok,
        telegram: Boolean(telegramBotToken),
        vk: Boolean(vkAppId && vkAppSecret),
        unifiedAccounts: true,
        linkCodes: true,
        bar: BAR_CODE,
        timestamp: new Date().toISOString(),
        ...publicReleaseMetadata()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/release-readiness') {
      const legalConfigured = Boolean(
        legalOperatorName
          && legalOperatorId
          && legalContactEmail
          && legalOperatorAddress
          && legalDataRetentionPolicy
      );
      const ready = platformReady
        && childReady
        && Boolean(databaseFingerprint)
        && (process.env.NODE_ENV !== 'production' || legalConfigured)
        && (process.env.NODE_ENV !== 'production' || configuredIdentityTombstoneSecret.length >= 32);
      return sendJson(res, ready ? 200 : 503, {
        ok: ready,
        childReady,
        platformReady,
        legalConfigured,
        identityTombstoneSecretConfigured: configuredIdentityTombstoneSecret.length >= 32,
        telegramConfigured: Boolean(telegramBotToken),
        vkConfigured: Boolean(vkAppId && vkAppSecret),
        ...publicReleaseMetadata(),
        timestamp: new Date().toISOString()
      });
    }`,
  'release readiness endpoint'
);

gateway = replaceRequired(
  gateway,
  `      await waitForChild();
      await initPlatformDatabase();`,
  `      await waitForChild();
      await initPlatformDatabase();
      await refreshDatabaseFingerprint();`,
  'database fingerprint initialization'
);

for (const marker of [
  'IDENTITY_TOMBSTONE_SECRET',
  'identityTombstoneSecret',
  'databaseFingerprint',
  '/api/release-readiness',
  'serveLegalDocument',
  'refreshDatabaseFingerprint'
]) {
  if (!gateway.includes(marker)) {
    throw new Error(`Production hardening verification failed: ${marker}`);
  }
}

await fs.writeFile(gatewayPath, gateway, 'utf8');
console.log('Pivnik production hardening applied and verified.');
