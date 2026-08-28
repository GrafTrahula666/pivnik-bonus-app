import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  app: path.join(root, 'app.js'),
  index: path.join(root, 'index.html'),
  gateway: path.join(root, 'universal-server.js'),
  redCss: path.join(root, 'red-cosmos-v2.css')
};

async function read(key) { return fs.readFile(paths[key], 'utf8'); }
async function write(key, value) { await fs.writeFile(paths[key], value, 'utf8'); }

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`release candidate fix: missing ${label}`);
  return source.replace(from, () => to);
}

let app = await read('app');
app = replaceRequired(
  app,
  `  $('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
  $('.bottom-nav [data-target]').forEach((button) => button.classList.toggle('active', button.dataset.target === target));`,
  `  $$('.screen').forEach((screen) => screen.classList.toggle('active', screen.dataset.screen === target));
  $$('.bottom-nav [data-target]').forEach((button) => button.classList.toggle('active', button.dataset.target === target));`,
  'NodeList navigation'
);
app = replaceRequired(
  app,
  `$('#openProfileStatistics')?.addEventListener('click', () => openModal('profileStatsModal'));
$('#openConnectedServices')?.addEventListener('click', openConnectedServices);`,
  `$('#openProfileStatistics')?.addEventListener('click', () => openModal('profileStatsModal'));
$('#openProfileShop')?.addEventListener('click', () => { openModal('shopModal'); renderShopCatalog(); });
$('#openConnectedServices')?.addEventListener('click', openConnectedServices);`,
  'profile shop handler'
);
await write('app', app);

let index = await read('index');
index = replaceRequired(
  index,
  `        <div class="profile-menu vip-glass-card">
          <button type="button" id="openConnectedServices">`,
  `        <div class="profile-menu vip-glass-card">
          <button type="button" id="openProfileShop"><span>◇</span><div><b>Магазин</b><small>Рамки и коллекционные награды</small></div><i>›</i></button>
          <button type="button" id="openConnectedServices">`,
  'profile shop entry'
);
await write('index', index);

let gateway = await read('gateway');
gateway = replaceRequired(
  gateway,
  `    /<link rel="stylesheet" href="styles\\.css([^"]*)"\\s*\\/>/i,
    '<link rel="stylesheet" href="styles.css$1" />\\n  <link rel="stylesheet" href="/loader-fix.css?v=2.1.0" />'`,
  `    /<link rel="stylesheet" href="\\/?styles\\.css([^"]*)"\\s*\\/>/i,
    '<link rel="stylesheet" href="/styles.css$1" />\\n  <link rel="stylesheet" href="/loader-fix.css?v=2.1.0" />'`,
  'root styles.css path'
);
gateway = replaceRequired(
  gateway,
  `    /<script defer src="app\\.js([^"]*)"><\\/script>/i,
    '<script defer src="/account-link.js?v=2.3.0"></script>\\n  <script defer src="app.js$1"></script>'`,
  `    /<script defer src="\\/?app\\.js([^"]*)"><\\/script>/i,
    '<script defer src="/account-link.js?v=2.3.0"></script>\\n  <script defer src="/app.js$1"></script>'`,
  'root app.js path'
);
gateway = replaceRequired(
  gateway,
  `  if (platform !== 'vk') {
    return withLinking.replace(
      /<!-- telegram-wheel-legacy:start -->[\\s\\S]*?<!-- telegram-wheel-legacy:end -->/g,
      ''
    );
  }
  return withLinking`,
  `  const platformClass = platform === 'vk' ? 'platform-vk' : 'platform-telegram';
  const withPlatformClass = withLinking.replace(
    /<body(?:\\s+class="([^"]*)")?\\s*>/i,
    (_match, existingClass = '') => '<body class="' + (existingClass + ' ' + platformClass).trim() + '">'
  );

  if (platform !== 'vk') return withPlatformClass;

  return withPlatformClass`,
  'platform document body and Telegram primary actions'
);
await write('gateway', gateway);

let redCss = await read('redCss');
if (!redCss.includes('.platform-vk #qrToken,.platform-vk #copyQrCode')) {
  redCss = replaceRequired(
    redCss,
    '.platform-vk #qrModal .qr-warning{display:none!important}',
    '.platform-vk #qrModal .qr-warning{display:none!important}\n.platform-vk #qrToken,.platform-vk #copyQrCode{display:none!important}',
    'VK QR technical controls CSS'
  );
}
await write('redCss', redCss);

const failures = [];
if (!app.includes("$$('.screen').forEach") || app.includes("\n  $('.screen').forEach")) failures.push('navigation');
if (!app.includes("$('#openProfileShop')?.addEventListener('click'")) failures.push('profile shop handler');
if (!index.includes('id="openProfileShop"')) failures.push('profile shop entry');
if (!gateway.includes('href="/styles.css$1"') || !gateway.includes('src="/app.js$1"')) failures.push('root assets');
if (gateway.includes("if (platform !== 'vk') {\n    return withLinking.replace(\n      /<!-- telegram-wheel-legacy:start")) failures.push('Telegram primary actions');
if (!gateway.includes("platform === 'vk' ? 'platform-vk' : 'platform-telegram'")) failures.push('platform class');
if (!redCss.includes('.platform-vk #qrToken,.platform-vk #copyQrCode{display:none!important}')) failures.push('VK QR cleanup');
if (failures.length) throw new Error(`release candidate verification failed: ${failures.join(', ')}`);

console.log('Release candidate interaction fixes are applied and verified.');
