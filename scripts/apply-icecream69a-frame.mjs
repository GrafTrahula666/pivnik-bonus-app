import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'PIVNIK_ICECREAM69A_FRAME_20260909';

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  return fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`IceCream69A frame: missing ${label}`);
  return source.replace(from, () => to);
}

function patchBackend(source, label) {
  if (source.includes(MARKER)) return source;

  const profileAnchor = 'function profileFrameFromRow(row) {\n';
  const profileReplacement = `// ${MARKER}\nfunction isIceCream69ARow(row) {\n  return String(row?.username || '')\n    .trim()\n    .replace(/^@+/, '')\n    .toLowerCase() === 'icecream69a';\n}\n\nfunction profileFrameFromRow(row) {\n  if (isIceCream69ARow(row)) return 'icecream69a';\n`;
  source = replaceRequired(source, profileAnchor, profileReplacement, `${label} profile frame helper`);

  const availableAnchor = 'function availableFramesFromRow(row) {\n';
  const availableReplacement = `function availableFramesFromRow(row) {\n  if (isIceCream69ARow(row)) return [{ code: 'icecream69a', title: 'Персональная рамка 🔞 😈' }];\n`;
  source = replaceRequired(source, availableAnchor, availableReplacement, `${label} available frame helper`);

  return source;
}

function patchApp(source) {
  if (source.includes(MARKER)) return source;

  source = replaceRequired(
    source,
    "  if (entity.profileFrame === 'vladislav') return 'avatar-frame avatar-frame-vladislav';\n",
    "  if (entity.profileFrame === 'vladislav') return 'avatar-frame avatar-frame-vladislav';\n  if (entity.profileFrame === 'icecream69a') return 'avatar-frame avatar-frame-icecream69a';\n",
    'app frame class'
  );

  const orbitAnchor = "  return '';\n}\n\nfunction avatarInlineHtml(entity = {}, className = 'avatar', respectPrivacy = false) {";
  const orbitReplacement = `  if (entity.profileFrame === 'icecream69a') {\n    const symbols = Array.from({ length: 12 }, (_, index) => index % 2 === 0 ? '🔞' : '😈');\n    return '<span class="avatar-orbit icecream69a-orbit" aria-hidden="true">'\n      + symbols.map((symbol, index) => '<i style="--orbit-index:' + index + ';--counter-angle:' + (-index * 30) + 'deg"><span>' + symbol + '</span></i>').join('')\n      + '</span>';\n  }\n  return '';\n}\n\nfunction avatarInlineHtml(entity = {}, className = 'avatar', respectPrivacy = false) {`;
  source = replaceRequired(source, orbitAnchor, orbitReplacement, 'app orbit rendering');

  source = replaceRequired(
    source,
    "  element.classList.toggle('has-vladislav-frame', entity.profileFrame === 'vladislav');\n",
    "  element.classList.toggle('has-vladislav-frame', entity.profileFrame === 'vladislav');\n  element.classList.toggle('has-icecream69a-frame', entity.profileFrame === 'icecream69a');\n",
    'app profile avatar overflow class'
  );

  const functionMarker = 'function avatarFrameClass(entity = {}) {';
  if (!source.includes(functionMarker)) throw new Error('IceCream69A frame: app marker verification failed');
  return source.replace(functionMarker, `// ${MARKER}\n${functionMarker}`);
}

function patchCss(source) {
  if (source.includes(MARKER)) return source;

  return `${source.trimEnd()}\n\n/* ${MARKER}: isolated personal frame for @IceCream69A */\n.profile-avatar.has-icecream69a-frame,\n.profile-avatar.has-icecream69a-frame .avatar-render-inner,\n.avatar-frame-icecream69a {\n  overflow: visible !important;\n}\n\n.avatar-frame-icecream69a {\n  position: relative;\n  filter: drop-shadow(0 0 8px rgba(153, 74, 255, .42));\n}\n\n.avatar-frame-icecream69a::before {\n  content: '';\n  position: absolute;\n  inset: -4px;\n  padding: 2px;\n  border-radius: inherit;\n  pointer-events: none;\n  background: conic-gradient(from 0deg, rgba(255,58,58,.92), rgba(151,55,255,.9), rgba(255,58,58,.92));\n  box-shadow: 0 0 12px rgba(154,70,255,.38), 0 0 9px rgba(255,54,54,.24);\n  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);\n  -webkit-mask-composite: xor;\n  mask-composite: exclude;\n}\n\n.icecream69a-orbit {\n  position: absolute;\n  inset: -20px;\n  border-radius: 50%;\n  pointer-events: none;\n  animation: icecream69aOrbitSpin 6s linear infinite;\n}\n\n.icecream69a-orbit i {\n  --angle: calc(var(--orbit-index) * 30deg);\n  position: absolute;\n  left: 50%;\n  top: 50%;\n  width: 1px;\n  height: 1px;\n  transform: rotate(var(--angle)) translateY(-38px);\n  transform-origin: center;\n  font-style: normal;\n}\n\n.icecream69a-orbit i span {\n  display: grid;\n  place-items: center;\n  width: 20px;\n  height: 20px;\n  margin: -10px;\n  font-size: 17px;\n  line-height: 1;\n  filter: drop-shadow(0 0 4px rgba(210,100,255,.46));\n  animation: icecream69aEmojiCounterSpin 6s linear infinite;\n}\n\n.profile-avatar .icecream69a-orbit {\n  inset: -24px;\n}\n\n.profile-avatar .icecream69a-orbit i {\n  transform: rotate(var(--angle)) translateY(-44px);\n}\n\n.profile-avatar .icecream69a-orbit i span {\n  width: 22px;\n  height: 22px;\n  margin: -11px;\n  font-size: 19px;\n}\n\n@keyframes icecream69aOrbitSpin {\n  to { transform: rotate(360deg); }\n}\n\n@keyframes icecream69aEmojiCounterSpin {\n  from { transform: rotate(var(--counter-angle)); }\n  to { transform: rotate(calc(var(--counter-angle) - 360deg)); }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .icecream69a-orbit,\n  .icecream69a-orbit i span {\n    animation: none !important;\n  }\n}\n`;
}

const [server, gateway, app, css] = await Promise.all([
  read('server.js'),
  read('universal-server.js'),
  read('app.js'),
  read('styles.css')
]);

const patchedServer = patchBackend(server, 'server.js');
const patchedGateway = patchBackend(gateway, 'universal-server.js');
const patchedApp = patchApp(app);
const patchedCss = patchCss(css);

await Promise.all([
  patchedServer === server ? Promise.resolve() : write('server.js', patchedServer),
  patchedGateway === gateway ? Promise.resolve() : write('universal-server.js', patchedGateway),
  patchedApp === app ? Promise.resolve() : write('app.js', patchedApp),
  patchedCss === css ? Promise.resolve() : write('styles.css', patchedCss)
]);

const verification = [
  [patchedServer, "isIceCream69ARow(row)) return 'icecream69a'", 'server assignment'],
  [patchedGateway, "isIceCream69ARow(row)) return 'icecream69a'", 'gateway assignment'],
  [patchedApp, "profileFrame === 'icecream69a'", 'app frame rendering'],
  [patchedApp, "index % 2 === 0 ? '🔞' : '😈'", 'alternating symbols'],
  [patchedCss, '.icecream69a-orbit', 'orbit CSS'],
  [patchedCss, '@keyframes icecream69aOrbitSpin', 'orbit animation']
];

for (const [source, needle, label] of verification) {
  if (!source.includes(needle)) throw new Error(`IceCream69A frame verification failed: ${label}`);
}

console.log('IceCream69A frame materialized without touching unrelated user rules.');
