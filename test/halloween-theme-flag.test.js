import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Halloween skin is behind design.theme and every rule is scoped to html.theme-halloween', async () => {
  const [app, css] = await Promise.all([read('app.js'), read('styles.css')]);
  assert.match(app, /classList\.toggle\('theme-halloween', design\.theme === 'halloween'\)/);

  assert.match(app, /applyHalloweenCopy\(design\.theme === 'halloween'\)/);
  assert.match(app, /Выполняйте задания, получайте билеты/);

  const marker = css.indexOf('Halloween "Midnight" theme');
  assert.ok(marker > 0, 'Halloween block is missing');
  const block = css.slice(css.lastIndexOf('/*', marker)).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = block.split('{').slice(0, -1).map((chunk) => chunk.split('}').pop().trim()).filter(Boolean);
  assert.ok(selectors.length > 10);
  for (const selector of selectors) {
    for (const part of selector.split(',')) {
      assert.match(part.trim(), /^html\.theme-halloween\b/, `unscoped Halloween selector: ${part.trim()}`);
    }
  }

  for (const asset of ['night-bg.webp', 'hero-card-midnight.webp']) {
    await access(new URL(`../assets/halloween/${asset}`, import.meta.url));
    assert.ok(css.includes(`/assets/halloween/${asset}`), `${asset} is not referenced`);
  }
});
