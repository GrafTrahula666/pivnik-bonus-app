import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'PIVNIK_FRAME_SHOP_ROTATION_OWNER_ALL_20260909';

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function write(relativePath, content) {
  return fs.writeFile(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Frame shop polish: missing ${label}`);
  return source.replace(from, () => to);
}

const ownerCatalogSource = `const OWNER_FRAME_CATALOG = Object.freeze([\n  { code: 'none', title: 'Без рамки' },\n  { code: 'money', title: 'Долларовая рамка' },\n  { code: 'fire', title: 'Огненная рамка' },\n  { code: 'diamond', title: 'Алмазная рамка' },\n  { code: 'beer-mugs', title: 'Пивные кружки' },\n  { code: 'beer-bottles', title: 'Пивные бутылки' },\n  { code: 'lights', title: 'Огоньки' },\n  { code: 'middle-finger', title: 'Смайлик с факом' },\n  { code: 'premium-smiling-fuck', title: 'Premium рамка' },\n  { code: 'anna', title: 'Персональная рамка Анны' },\n  { code: 'olesya', title: 'Рамка из множества сердечек' },\n  { code: 'vladislav', title: 'Рамка из 12 пульсирующих какашек' },\n  { code: 'icecream69a', title: 'Персональная рамка 🔞 😈' }\n]);\nconst OWNER_FRAME_CODES = new Set(OWNER_FRAME_CATALOG.map((frame) => frame.code));\n\n`;

function patchBackend(source, label) {
  if (source.includes(MARKER)) return source;

  const profileAnchor = `function profileFrameFromRow(row) {\n  if (isIceCream69ARow(row)) return 'icecream69a';\n  if (isOwnerRow(row)) return 'money';`;
  const profileReplacement = `// ${MARKER}\n${ownerCatalogSource}function profileFrameFromRow(row) {\n  if (isIceCream69ARow(row)) return 'icecream69a';\n  if (isOwnerRow(row)) {\n    const selectedFrame = String(row?.profile_frame || row?.profileFrame || '');\n    return OWNER_FRAME_CODES.has(selectedFrame) ? selectedFrame : 'money';\n  }`;
  source = replaceRequired(source, profileAnchor, profileReplacement, `${label} owner selected frame`);

  source = replaceRequired(
    source,
    "  if (isOwnerRow(row)) return [{ code: 'money', title: 'Долларовая рамка' }];",
    "  if (isOwnerRow(row)) return OWNER_FRAME_CATALOG.map((frame) => ({ ...frame }));",
    `${label} owner frame catalog`
  );

  if (label === 'server.js') {
    source = replaceRequired(
      source,
      "    const storedFrame = isOwnerRow(accessRow) || isAnnaRow(accessRow) || accessRow?.role === 'viewer' ? profileFrameFromRow(accessRow) : requestedFrame;",
      "    const storedFrame = isAnnaRow(accessRow) || accessRow?.role === 'viewer' ? profileFrameFromRow(accessRow) : requestedFrame;",
      'server owner frame selection persistence'
    );
  } else {
    source = replaceRequired(
      source,
      "    if (isOwnerRow(row)) storedFrame = 'money';\n    else if (isAnnaRow(row)) storedFrame = 'anna';",
      "    if (isAnnaRow(row)) storedFrame = 'anna';",
      'gateway owner frame selection persistence'
    );
  }

  return source;
}

function patchCss(source) {
  if (source.includes(MARKER)) return source;
  return `${source.trimEnd()}\n\n/* ${MARKER}: animation exists only on the shop shelf; equipped profile frames keep their own behavior. */\n.shop-frame-live-preview[data-frame-preview] {\n  --shop-frame-a: rgba(196,30,58,.96);\n  --shop-frame-b: rgba(126,56,255,.92);\n}\n.shop-frame-live-preview[data-frame-preview=\"beer-mugs\"] { --shop-frame-a:#ffbd45; --shop-frame-b:#ff7a20; }\n.shop-frame-live-preview[data-frame-preview=\"beer-bottles\"] { --shop-frame-a:#7ed06a; --shop-frame-b:#2f8d49; }\n.shop-frame-live-preview[data-frame-preview=\"lights\"] { --shop-frame-a:#ff3154; --shop-frame-b:#a532e1; }\n.shop-frame-live-preview[data-frame-preview=\"premium-smiling-fuck\"] { --shop-frame-a:#ffd700; --shop-frame-b:#fff1a1; }\n\n.shop-frame-live-preview[data-frame-preview]::before {\n  content:\"\";\n  position:absolute;\n  left:50%;\n  top:50%;\n  width:124px;\n  height:124px;\n  margin:-70px 0 0 -62px;\n  border-radius:50%;\n  pointer-events:none;\n  z-index:0;\n  background:conic-gradient(\n    from 0deg,\n    transparent 0 16deg,\n    var(--shop-frame-a) 16deg 62deg,\n    transparent 62deg 106deg,\n    var(--shop-frame-b) 106deg 176deg,\n    transparent 176deg 226deg,\n    var(--shop-frame-a) 226deg 292deg,\n    transparent 292deg 326deg,\n    var(--shop-frame-b) 326deg 360deg\n  );\n  -webkit-mask:radial-gradient(circle,transparent 0 54px,#000 55px 61px,transparent 62px);\n  mask:radial-gradient(circle,transparent 0 54px,#000 55px 61px,transparent 62px);\n  filter:drop-shadow(0 0 8px var(--shop-frame-a));\n  animation:shopFrameShelfSpin 4.6s linear infinite;\n}\n\n.shop-frame-live-preview[data-frame-preview] .shop-frame-preview-avatar {\n  z-index:1;\n}\n\n@keyframes shopFrameShelfSpin {\n  to { transform:rotate(360deg); }\n}\n\n@media(max-width:520px) {\n  .shop-frame-live-preview[data-frame-preview]::before {\n    width:108px;\n    height:108px;\n    margin:-62px 0 0 -54px;\n    -webkit-mask:radial-gradient(circle,transparent 0 46px,#000 47px 53px,transparent 54px);\n    mask:radial-gradient(circle,transparent 0 46px,#000 47px 53px,transparent 54px);\n  }\n}\n\n@media(prefers-reduced-motion:reduce) {\n  .shop-frame-live-preview[data-frame-preview]::before { animation:none!important; }\n}\n`;
}

const [server, gateway, css, shopFragment] = await Promise.all([
  read('server.js'),
  read('universal-server.js'),
  read('red-cosmos-v2.css'),
  read('scripts/fragments/red-cosmos-shop-client.fragment.txt')
]);

const patchedServer = patchBackend(server, 'server.js');
const patchedGateway = patchBackend(gateway, 'universal-server.js');
const patchedCss = patchCss(css);

await Promise.all([
  patchedServer === server ? Promise.resolve() : write('server.js', patchedServer),
  patchedGateway === gateway ? Promise.resolve() : write('universal-server.js', patchedGateway),
  patchedCss === css ? Promise.resolve() : write('red-cosmos-v2.css', patchedCss)
]);

const allCurrentFrames = [
  'money','fire','diamond','beer-mugs','beer-bottles','lights','middle-finger',
  'premium-smiling-fuck','anna','olesya','vladislav','icecream69a'
];
for (const frameCode of allCurrentFrames) {
  if (!patchedServer.includes(`code: '${frameCode}'`) || !patchedGateway.includes(`code: '${frameCode}'`)) {
    throw new Error(`Frame shop polish verification failed: owner missing ${frameCode}`);
  }
}
if (!patchedCss.includes('@keyframes shopFrameShelfSpin')) throw new Error('Frame shop polish verification failed: shelf animation');
if (!patchedCss.includes('.shop-frame-live-preview[data-frame-preview]::before')) throw new Error('Frame shop polish verification failed: shelf selector');
if (!shopFragment.includes("api('/api/shop/buy'")) throw new Error('Frame shop polish verification failed: purchase endpoint');
if (!shopFragment.includes('if (data.profile) state.profile = data.profile;')) throw new Error('Frame shop polish verification failed: purchased profile refresh');
if (!shopFragment.includes('renderProfile();')) throw new Error('Frame shop polish verification failed: profile rerender');

console.log('Frame shop shelf animation and owner all-frame access materialized without altering purchase accounting.');
