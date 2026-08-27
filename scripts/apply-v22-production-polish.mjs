import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gatewayPath = path.join(root, 'universal-server.js');
const MARKER = 'PIVNIK_V22_PRODUCTION_POLISH_20260827';
let source = await fs.readFile(gatewayPath, 'utf8');

if (source.includes(`// ${MARKER}`)) {
  console.log('Pivnik v22 production polish already materialized; restart-safe skip.');
  process.exit(0);
}

function replaceRequired(from, to, label) {
  if (source.includes(to)) return;
  if (!source.includes(from)) throw new Error(`v22 polish: fragment not found: ${label}`);
  source = source.replace(from, to);
}

replaceRequired(
  `               photo_url = $5,
               language_code = $6,`,
  `               photo_url = COALESCE($5, photo_url),
               language_code = $6,`,
  'preserve main platform photo on partial auth payload'
);

replaceRequired(
  `           provider_username = EXCLUDED.provider_username,
           profile_url = EXCLUDED.profile_url,
           updated_at = NOW()`,
  `           provider_username = COALESCE(EXCLUDED.provider_username, user_identities.provider_username),
           profile_url = COALESCE(EXCLUDED.profile_url, user_identities.profile_url),
           updated_at = NOW()`,
  'preserve identity profile metadata on partial auth payload'
);

// RED COSMOS v2 owns the production DB prepare/audit lifecycle. The old v22
// delayed audit referenced a superseded schema shape and produced a noisy 42703
// warning after every healthy Telegram startup, so it is intentionally retired.
source += `\n// ${MARKER}\n`;
await fs.writeFile(gatewayPath, source, 'utf8');
console.log('Pivnik v22 production polish applied: photo persistence; legacy startup audit retired.');
