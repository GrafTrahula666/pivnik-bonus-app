import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('service white-gold layer is wired after the canonical stylesheet by the runtime materializer', async () => {
  const shell = await read('scripts/apply-red-cosmos-v2-shell-final.mjs');
  assert.match(shell, /SERVICE_STYLE_HREF/);
  assert.match(shell, /service-white-gold\.css\?v=\$\{SERVICE_STYLE_VERSION\}/);
  assert.match(shell, /canonicalStyleTag[\s\S]*SERVICE_STYLE_HREF/);
});

test('service layer is visual-only and scoped to service-mode staff/admin runtime', async () => {
  const css = await read('service-white-gold.css');
  assert.match(css, /\.app-shell\.service-mode/);
  assert.match(css, /screen\[data-screen="staff"\]/);
  assert.match(css, /screen\[data-screen="admin"\]/);
  assert.doesNotMatch(css, /pointer-events\s*:/);
  assert.doesNotMatch(css, /position\s*:\s*fixed/);
  assert.doesNotMatch(css, /z-index\s*:/);
  assert.doesNotMatch(css, /\.client-home|data-screen="client"|data-screen="profile"|data-screen="league"/);
});

test('service layer removes legacy purple/blue/red surfaces while reserving red for danger semantics', async () => {
  const css = await read('service-white-gold.css');
  assert.doesNotMatch(css, /(?:--primary-red|--dark-red|--cosmic-purple|#c41e3a|#8b0000|#4a0d3a|#0d0002|#16030e|#2a0a1f|rgba\(47,\s*8,\s*31|rgba\(13,\s*0,\s*2)/i);
  assert.match(css, /Red remains reserved for genuinely destructive\/danger controls/);
  assert.match(css, /#adminRoleBadge\.pill\.danger/);
  assert.match(css, /#adminRoleBadge\.danger \{ color: #96620f; \}/);
});

test('service layer preserves mobile scrolling and safe-area padding instead of viewport shrinking', async () => {
  const css = await read('service-white-gold.css');
  assert.match(css, /padding-bottom: calc\(28px \+ env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(css, /max-height\s*:/);
  assert.doesNotMatch(css, /overflow\s*:\s*hidden/);
  assert.doesNotMatch(css, /transform\s*:\s*scale/);
});


test('service layer targets the actual dynamic admin and staff row classes', async () => {
  const [css, app] = await Promise.all([read('service-white-gold.css'), read('app.js')]);

  for (const selector of ['op-row', 'user-row', 'inquiry-row', 'admin-content-row', 'shift-staff-option', 'staff-shop-item']) {
    assert.ok(app.includes(`class="${selector}`), `${selector} must be rendered by app.js`);
    assert.ok(css.includes(`.${selector}`), `${selector} must be styled by the service layer`);
  }

  assert.match(css, /#adminUsersModal \.admin-filter-row/);
  assert.match(css, /#adminTransactionsModal \.admin-filter-row/);
  assert.match(css, /#adminInquiriesModal \.admin-filter-row/);
  assert.match(css, /#contentEditorModal \.modal-sheet/);
  assert.doesNotMatch(css, /rgba\(12,\s*15,\s*20,\s*\.98\)/);
});

test('service row repair keeps warning and destructive colors semantic', async () => {
  const css = await read('service-white-gold.css');
  assert.match(css, /\.op-row\.suspicious[\s\S]*?background:\s*#fff8e9/);
  assert.match(css, /\.danger-text,[\s\S]*?\.cancel-operation-button[\s\S]*?color:\s*#a23f38/);
  assert.match(css, /#adminRoleBadge\.pill\.danger[\s\S]*?color:\s*#96620f/);
});
