import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const stylesPath = path.join(root, 'styles.css');
const indexPath = path.join(root, 'index.html');

const START = '/* luxury-vip-space-runtime:start */';
const END = '/* luxury-vip-space-runtime:end */';
const VERSION = '20260813-luxury-vip-space-v2';

const override = `
${START}
.app-shell {
  position: relative;
  isolation: isolate;
  background:
    linear-gradient(180deg, rgba(3, 3, 7, .08), rgba(5, 3, 7, .22) 62%, rgba(4, 2, 5, .38)),
    url("/assets/backgrounds/luxury-vip-space.webp?v=${VERSION}") center top / cover fixed no-repeat !important;
}
.app-shell::before {
  content: "" !important;
  position: fixed !important;
  left: 50% !important;
  top: 0 !important;
  width: min(100%, 480px) !important;
  height: 100dvh !important;
  transform: translateX(-50%) !important;
  pointer-events: none !important;
  z-index: 0 !important;
  background:
    linear-gradient(180deg, rgba(3, 3, 7, .03), rgba(5, 3, 7, .12) 58%, rgba(4, 2, 5, .28) 100%),
    radial-gradient(circle at 50% 8%, rgba(128, 43, 62, .12), transparent 38%),
    url("/assets/backgrounds/luxury-vip-space.webp?v=${VERSION}") center top / cover no-repeat !important;
  opacity: 1 !important;
  filter: saturate(1.18) contrast(1.08) brightness(1.48) !important;
}
.app-shell::after {
  content: "" !important;
  position: fixed !important;
  left: 50% !important;
  top: 0 !important;
  width: min(100%, 480px) !important;
  height: 100dvh !important;
  transform: translateX(-50%) !important;
  pointer-events: none !important;
  z-index: 0 !important;
  background:
    radial-gradient(circle at 18% 16%, rgba(255,255,255,.16) 0 1px, transparent 1.4px),
    radial-gradient(circle at 72% 28%, rgba(255,255,255,.10) 0 1px, transparent 1.4px),
    radial-gradient(circle at 44% 62%, rgba(200,164,110,.08) 0 1px, transparent 1.5px);
  background-size: 122px 122px, 168px 168px, 214px 214px;
  opacity: .16 !important;
}
.topbar { position: relative; z-index: 2; }
.screen { position: relative; z-index: 1; background: transparent !important; }
.android-webview .app-shell::before,
.lite-mode .app-shell::before {
  background-attachment: scroll !important;
  filter: brightness(1.34) saturate(1.08) contrast(1.06) !important;
}
.android-webview .app-shell,
.lite-mode .app-shell {
  background-attachment: scroll !important;
}
${END}
`;

let css = await fs.readFile(stylesPath, 'utf8');
const runtimeBlock = new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`, 'g');
css = css.replace(runtimeBlock, '').trimEnd() + '\n' + override;
await fs.writeFile(stylesPath, css, 'utf8');

let html = await fs.readFile(indexPath, 'utf8');
html = html.replace(/styles\.css\?v=[^"']+/g, `styles.css?v=${VERSION}`);
await fs.writeFile(indexPath, html, 'utf8');

console.log('Luxury VIP Space background applied:', VERSION);
