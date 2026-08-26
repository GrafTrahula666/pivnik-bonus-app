import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const gatewayPath = path.join(root, 'universal-server.js');
const indexPath = path.join(root, 'index.html');
const childServerPath = path.join(root, 'server.js');
const earlyInitPath = path.join(root, 'vk-early-init.js');

async function writeIfChanged(filePath, before, after) {
  if (after !== before) await fs.writeFile(filePath, after, 'utf8');
}

let source = await fs.readFile(gatewayPath, 'utf8');

const oldScripts = `'<script defer src="/vendor/vk-bridge.js?v=2.15.11"></script>\\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\\n  <script defer src="/account-link.js$1"></script>'`;
const previousScripts = `'<script src="/vendor/vk-bridge.js?v=2.15.11"></script>\\n  <script src="/vk-early-init.js?v=1.0.0"></script>\\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\\n  <script defer src="/account-link.js$1"></script>'`;
const newScripts = `'<script src="/vk-early-init.js?v=1.1.0-ios-native"></script>\\n  <script src="/vendor/vk-bridge.js?v=2.15.11"></script>\\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\\n  <script defer src="/account-link.js$1"></script>'`;

if (source.includes(previousScripts)) {
  source = source.replace(previousScripts, newScripts);
} else if (!source.includes('/vk-early-init.js?v=1.1.0-ios-native')) {
  if (!source.includes(oldScripts)) {
    throw new Error('VK script injection anchor not found; refusing unsafe patch.');
  }
  source = source.replace(oldScripts, newScripts);
}

if (!source.includes("url.pathname === '/vk-early-init.js'")) {
  const routeAnchor = `    if (req.method === 'GET' && url.pathname === '/loader-fix.css') {`;
  if (!source.includes(routeAnchor)) {
    throw new Error('VK early-init route anchor not found; refusing unsafe patch.');
  }
  const route = `    if (req.method === 'GET' && url.pathname === '/vk-early-init.js') {\n      return serveFile(res, path.join(__dirname, 'vk-early-init.js'), 'text/javascript; charset=utf-8', 'no-store');\n    }\n\n`;
  source = source.replace(routeAnchor, route + routeAnchor);
} else {
  source = source.replace(
    "'text/javascript; charset=utf-8', 'no-cache'",
    "'text/javascript; charset=utf-8', 'no-store'"
  );
}

// A VK launch URL may be normalized from /vk to /vk/. Without root-absolute
// assets the browser then asks for /vk/app.js, and the legacy SPA fallback
// answers with HTML. Under nosniff that means app.js never executes and the
// boot screen can stay visible forever. Make the renderer tolerate both source
// forms and always emit root-absolute asset URLs.
source = source
  .replace('href="styles\\.css', 'href="\\/?styles\\.css')
  .replace('href="styles.css$1"', 'href="/styles.css$1"')
  .replace('src="app\\.js', 'src="\\/?app\\.js')
  .replace('src="app.js$1"', 'src="/app.js$1"');

await writeIfChanged(gatewayPath, await fs.readFile(gatewayPath, 'utf8'), source);

let indexSource = await fs.readFile(indexPath, 'utf8');
const patchedIndex = indexSource
  .replace(/href="styles\.css/g, 'href="/styles.css')
  .replace(/src="app\.js/g, 'src="/app.js');
await writeIfChanged(indexPath, indexSource, patchedIndex);
indexSource = patchedIndex;

let childSource = await fs.readFile(childServerPath, 'utf8');
const legacyFallback = "app.use((_req, res) => res.sendFile(path.join(__dirname, 'index.html')));";
const safeFallback = `app.use((req, res) => {\n  const pathname = String(req.path || req.url || '').split('?')[0];\n  if (path.extname(pathname)) {\n    return res.status(404).type('text/plain').send('Not found');\n  }\n  return res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'index.html'));\n});`;
if (!childSource.includes('path.extname(pathname)')) {
  if (!childSource.includes(legacyFallback)) {
    throw new Error('SPA fallback anchor not found; refusing unsafe VK asset patch.');
  }
  childSource = childSource.replace(legacyFallback, safeFallback);
  await fs.writeFile(childServerPath, childSource, 'utf8');
}

const earlyInit = await fs.readFile(earlyInitPath, 'utf8');

const failures = [];
if (!indexSource.includes('href="/styles.css') || !indexSource.includes('src="/app.js')) {
  failures.push('root-absolute index assets');
}
if (!source.includes('href="\\/?styles\\.css') || !source.includes('href="/styles.css$1"')) {
  failures.push('root-absolute rendered stylesheet');
}
if (!source.includes('src="\\/?app\\.js') || !source.includes('src="/app.js$1"')) {
  failures.push('root-absolute rendered app script');
}
if (!childSource.includes('path.extname(pathname)')) failures.push('asset 404 fallback');
if (!earlyInit.includes("window.__PIVNIK_PLATFORM__ = 'vk';")) failures.push('early VK platform marker');
if (!earlyInit.includes('messageHandlers?.VKWebAppInit')) failures.push('direct iOS VK init');
if (!earlyInit.includes('AndroidBridge?.VKWebAppInit')) failures.push('direct Android VK init');
if (!earlyInit.includes('ReactNativeWebView.postMessage')) failures.push('direct React Native VK init');
if (!earlyInit.includes("bridge.send('VKWebAppInit', {})")) failures.push('VK Bridge init fallback');
const earlyInitIndex = source.indexOf('/vk-early-init.js?v=1.1.0-ios-native');
const bridgeIndex = source.indexOf('/vendor/vk-bridge.js?v=2.15.11');
if (!(earlyInitIndex >= 0 && bridgeIndex >= 0 && earlyInitIndex < bridgeIndex)) {
  failures.push('native init before bridge bundle');
}
if (!source.includes("'text/javascript; charset=utf-8', 'no-store'")) failures.push('uncached VK early init');
if (failures.length) {
  throw new Error(`VK boot hardening incomplete: ${failures.join(', ')}`);
}

console.log('Applied VK native early initialization and trailing-slash boot hardening.');
