import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const serverPath = path.join(root, 'universal-server.js');

let source = await fs.readFile(serverPath, 'utf8');

const oldScripts = `'<script defer src="/vendor/vk-bridge.js?v=2.15.11"></script>\\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\\n  <script defer src="/account-link.js$1"></script>'`;
const newScripts = `'<script src="/vendor/vk-bridge.js?v=2.15.11"></script>\\n  <script src="/vk-early-init.js?v=1.0.0"></script>\\n  <script defer src="/vk-platform.js?v=3.2.2-anna-consent-persistence"></script>\\n  <script defer src="/account-link.js$1"></script>'`;

if (!source.includes('/vk-early-init.js?v=1.0.0')) {
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
  const route = `    if (req.method === 'GET' && url.pathname === '/vk-early-init.js') {\n      return serveFile(res, path.join(__dirname, 'vk-early-init.js'), 'text/javascript; charset=utf-8', 'no-cache');\n    }\n\n`;
  source = source.replace(routeAnchor, route + routeAnchor);
}

await fs.writeFile(serverPath, source);
console.log('Applied early VK Mini App initialization.');
