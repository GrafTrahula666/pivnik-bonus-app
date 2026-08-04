import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const packagePath = path.join(root, 'package.json');
const bootstrapVladPath = path.join(root, 'bootstrap-vlad.js');
const bootstrapPath = path.join(root, 'bootstrap.js');
const markerPath = path.join(root, '.pivnik-materialized');

const FINAL_START_COMMAND = 'node universal-server.js';
const BOOTSTRAP_IMPORT = "await import('./bootstrap.js');";
const MATERIALIZED_BOOTSTRAP_IMPORT = `const preparedBootstrapSource = await fs.readFile(bootstrapPath, 'utf8');
const serverImport = "await import('./universal-server.js');";
if (preparedBootstrapSource.includes(serverImport)) {
  await fs.writeFile(
    bootstrapPath,
    preparedBootstrapSource.replace(
      serverImport,
      "if (process.env.PIVNIK_PATCH_ONLY !== '1') await import('./universal-server.js');"
    ),
    'utf8'
  );
}
process.env.PIVNIK_PATCH_ONLY = '1';
await import('./bootstrap.js');`;

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function verifyMaterializedState() {
  const [pkgText, app, gateway, styles, index] = await Promise.all([
    fs.readFile(packagePath, 'utf8'),
    read('app.js'),
    read('universal-server.js'),
    read('styles.css'),
    read('index.html')
  ]);
  const pkg = JSON.parse(pkgText);
  const failures = [];
  if (pkg.scripts?.start !== FINAL_START_COMMAND) failures.push('package.json start');
  if (!app.includes("const APP_VERSION = '17.3-vlad-poops';")) failures.push('app.js version');
  if (!app.includes("profileFrame === 'vladislav'")) failures.push('app.js Vladislav frame');
  if (!gateway.includes('vladislavTelegramId')) failures.push('universal-server.js Vladislav identity');
  if (!gateway.includes("storedFrame === 'olesya'")) failures.push('universal-server.js Olesya frame');
  if (!styles.includes('avatar-frame-vladislav')) failures.push('styles.css Vladislav frame');
  if (!index.includes('styles.css?v=17.3-vlad-poops')) failures.push('index.html asset version');
  if (failures.length) {
    throw new Error(`Материализация релиза неполная: ${failures.join(', ')}`);
  }
}

async function alreadyMaterialized() {
  try {
    await fs.access(markerPath);
    await verifyMaterializedState();
    return true;
  } catch {
    return false;
  }
}

if (!(await alreadyMaterialized())) {
  let bootstrapVlad = await fs.readFile(bootstrapVladPath, 'utf8');
  if (!bootstrapVlad.includes(MATERIALIZED_BOOTSTRAP_IMPORT)) {
    const importPosition = bootstrapVlad.lastIndexOf(BOOTSTRAP_IMPORT);
    if (importPosition < 0) {
      throw new Error('Не найден финальный импорт bootstrap.js для безопасной материализации.');
    }
    bootstrapVlad = `${bootstrapVlad.slice(0, importPosition)}${MATERIALIZED_BOOTSTRAP_IMPORT}${bootstrapVlad.slice(importPosition + BOOTSTRAP_IMPORT.length)}`;
    await fs.writeFile(bootstrapVladPath, bootstrapVlad, 'utf8');
  }

  process.env.PIVNIK_PATCH_ONLY = '1';
  await import(`${pathToFileURL(bootstrapVladPath).href}?materialize=${Date.now()}`);

  const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  pkg.scripts = { ...(pkg.scripts || {}), start: FINAL_START_COMMAND };
  await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');

  await verifyMaterializedState();
  await fs.writeFile(
    markerPath,
    `${JSON.stringify({ materializedAt: new Date().toISOString(), start: FINAL_START_COMMAND })}\n`,
    'utf8'
  );
}

console.log('Pivnik release sources are materialized and verified.');
