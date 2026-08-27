import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const write = (file, content) => fs.writeFile(path.join(root, file), content, 'utf8');

function replacePatternRequired(source, pattern, replacement, marker, label) {
  if (marker && source.includes(marker)) return source;
  if (!pattern.test(source)) throw new Error(`RED COSMOS v2 finalize: missing ${label}`);
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

async function finalizeServer() {
  let source = await read('server.js');

  // Final product contract is exactly four visible purchasable frame items.
  source = source.replace(
    /\n  \{ code: 'custom-mug-design'[^\n]*\},/,
    ''
  );
  source = source.replace(
    "code NOT IN ('custom-mug-design','frame-beer-mugs','frame-beer-bottles','frame-lights','frame-premium-smiling-fuck')",
    "code NOT IN ('frame-beer-mugs','frame-beer-bottles','frame-lights','frame-premium-smiling-fuck')"
  );
  source = source.replace(
    "RED COSMOS: четыре постоянные рамки за бонусы и индивидуальная кружка по запросу.",
    'RED COSMOS: четыре постоянные рамки за бонусы.'
  );

  if (source.includes("{ code: 'custom-mug-design'")) {
    throw new Error('RED COSMOS v2 finalize: custom mug leaked into client catalog defaults');
  }
  const requiredCodes = [
    'frame-beer-mugs',
    'frame-beer-bottles',
    'frame-lights',
    'frame-premium-smiling-fuck'
  ];
  for (const code of requiredCodes) {
    if (!source.includes(`code: '${code}'`)) throw new Error(`RED COSMOS v2 finalize: missing shop item ${code}`);
  }

  source += source.includes('// RED_COSMOS_V2_FINAL_SERVER') ? '' : '\n// RED_COSMOS_V2_FINAL_SERVER\n';
  await write('server.js', source);
}

async function finalizeGateway() {
  let source = await read('universal-server.js');

  source = replacePatternRequired(
    source,
    /function profileFrameFromRow\(row\) \{[\s\S]*?\n\}\n\nfunction availableFramesFromRow\(row\) \{[\s\S]*?\n\}\n\nfunction achievementsFromRow/,
    `function profileFrameFromRow(row) {
  if (isOwnerRow(row)) return 'money';
  if (isAnnaRow(row) || String(row?.profile_frame || row?.profileFrame || '') === 'anna') return 'anna';
  if (row?.role === 'viewer') return 'fire';
  const storedFrame = String(row?.profile_frame || '');
  const supported = new Set([
    'money', 'fire', 'diamond', 'olesya', 'vladislav', 'anna',
    'beer-mugs', 'beer-bottles', 'lights', 'premium-smiling-fuck'
  ]);
  return supported.has(storedFrame) ? storedFrame : 'none';
}

function availableFramesFromRow(row) {
  const titles = {
    none: 'Без рамки',
    money: 'Долларовая рамка',
    fire: 'Огненная рамка',
    diamond: 'Алмазная рамка',
    anna: 'Персональная рамка Анны',
    olesya: 'Рамка из множества сердечек',
    vladislav: 'Рамка Владислава',
    'beer-mugs': 'Пивные кружки',
    'beer-bottles': 'Пивные бутылки',
    lights: 'Огоньки',
    'premium-smiling-fuck': 'Смайлик с факом'
  };
  const owned = new Set(['none']);
  if (isOwnerRow(row)) owned.add('money');
  if (isAnnaRow(row)) owned.add('anna');
  if (row?.role === 'viewer') owned.add('fire');
  if (row?.owns_diamond_frame) owned.add('diamond');
  for (const frame of Array.isArray(row?.owned_frames) ? row.owned_frames : []) owned.add(String(frame));
  const current = String(row?.profile_frame || 'none');
  if (current && current !== 'none') owned.add(current);
  return [...owned].filter((code) => titles[code]).map((code) => ({ code, title: titles[code] }));
}

function achievementsFromRow`,
    'premium-smiling-fuck',
    'gateway frame entitlement helpers'
  );

  if (!source.includes('AS owned_frames')) {
    let replacements = 0;
    source = source.replace(/\) AS owns_diamond_frame/g, (match) => {
      replacements += 1;
      return `) AS owns_diamond_frame,\n            ARRAY(SELECT uf.frame_id FROM user_frames uf WHERE uf.user_id = u.id ORDER BY uf.acquired_at, uf.id) AS owned_frames`;
    });
    if (replacements < 2) {
      throw new Error(`RED COSMOS v2 finalize: expected at least two gateway profile queries, got ${replacements}`);
    }
  }

  if (!source.includes("'premium-smiling-fuck': 'Смайлик с факом'")) {
    throw new Error('RED COSMOS v2 finalize: gateway frame catalog was not installed');
  }
  if (!source.includes('AS owned_frames')) {
    throw new Error('RED COSMOS v2 finalize: gateway does not load permanent frame ownership');
  }

  source += source.includes('// RED_COSMOS_V2_FINAL_GATEWAY') ? '' : '\n// RED_COSMOS_V2_FINAL_GATEWAY\n';
  await write('universal-server.js', source);
}

async function finalizeClientCopy() {
  let source = await read('app.js');

  source = source.replace(
    /\n  const hero = \$\('\.hero-card'\);\n  if \(IS_VK && hero && !\$\('\.client-tip'\)\) \{[\s\S]*?\n  \}\n/,
    '\n'
  );
  source = source.replaceAll('Код постоянный и принадлежит только вам.', 'Покажите QR сотруднику перед оплатой.');
  source = source.replaceAll('QR постоянный. Не отправляйте его посторонним.', 'Не отправляйте QR посторонним.');

  if (/Код постоянный|QR постоянный|многоразов/i.test(source)) {
    throw new Error('RED COSMOS v2 finalize: legacy permanent/reusable QR copy remains in app.js');
  }

  source += source.includes('// RED_COSMOS_V2_FINAL_CLIENT') ? '' : '\n// RED_COSMOS_V2_FINAL_CLIENT\n';
  await write('app.js', source);
}

await finalizeServer();
await finalizeGateway();
await finalizeClientCopy();
console.log('RED COSMOS v2 finalized: four-item shop, persistent frames, clean QR copy.');
