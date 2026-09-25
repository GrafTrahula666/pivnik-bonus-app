import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('Home League avatars occupy the three baked artwork circles', async () => {
  const css = await read('styles.css');

  const marker = css.indexOf('League: seat live avatars inside the three baked circular slots.');
  assert.ok(marker >= 0, 'League avatar-slot marker must exist');

  const end = css.indexOf('/* Hide only the baked left cube', marker);
  const block = css.slice(marker, end);

  assert.match(block, /\.home-league-podium \.leader-avatar[\s\S]*position:\s*absolute/);
  assert.match(block, /\.home-league-podium \.leader-avatar[\s\S]*top:\s*16\.5%/);
  assert.match(block, /\.home-league-podium \.leader-avatar[\s\S]*width:\s*9\.25%/);
  assert.match(block, /> span:nth-child\(1\) \.leader-avatar \{ left:\s*5\.8%; \}/);
  assert.match(block, /> span:nth-child\(2\) \.leader-avatar \{ left:\s*41\.3%; \}/);
  assert.match(block, /> span:nth-child\(3\) \.leader-avatar \{ left:\s*75\.3%; \}/);

  assert.match(block, /border:\s*0 !important/);
  assert.match(block, /box-shadow:\s*none !important/);
  assert.match(block, /object-fit:\s*cover/);
  assert.match(block, /object-position:\s*center/);
});

test('League data rendering remains live and unchanged', async () => {
  const app = await read('app.js');

  assert.match(app, /const homePreview = \$\('#homeLeaderboardPreview'\)/);
  assert.match(app, /avatarInlineHtml\(leader, 'leader-avatar', true\)/);
  assert.match(app, /leader\?\.name \|\| 'Пока свободно'/);
  assert.match(app, /leader\?\.spend === null \|\| leader\?\.spend === undefined/);
});
