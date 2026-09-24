import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, css, index] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('achievement hub opens the catalog immediately and refreshes it on demand', () => {
  const start = app.indexOf('function openAchievementHub()');
  const end = app.indexOf("\n}\n\n$('#openAchievementsButton')", start);
  assert.ok(start >= 0 && end > start, 'openAchievementHub source must exist');
  const hub = app.slice(start, end + 2);

  assert.match(hub, /const hasPendingReward = \(state\.profile\?\.unannouncedAchievements \|\| \[\]\)\.length > 0/);
  assert.match(hub, /window\.setTimeout\(maybeShowAchievementCelebration, 0\)/);
  assert.match(hub, /openAchievements\(\)/);
  assert.match(hub, /if \(!state\.achievementsLoaded\)/);
  assert.match(hub, /void loadAchievements\(\)\.catch/);
  assert.ok(
    hub.indexOf('openAchievements();') < hub.indexOf('loadAchievements()'),
    'catalog must open before a background refresh'
  );
});

test('all achievement entry points use the repaired hub flow', () => {
  assert.match(app, /achievementEmptyOpen'\)\?\.addEventListener\('click', openAchievementHub\)/);
  assert.match(
    app,
    /state\.achievementTab = selected\?\.rarity \|\| 'common';\s*openAchievementHub\(\);/
  );
  assert.match(app, /openAchievementsButton'\)\?\.addEventListener\('click', openAchievementHub\)/);
});

test('white-gold achievement repair wins after the canonical client shell', () => {
  const shell = css.indexOf('V20.2 · SPACEVERSE white-gold canonical client experience');
  const repair = css.indexOf('V20.2.1 · ACHIEVEMENTS WHITE-GOLD REPAIR');
  assert.ok(shell >= 0 && repair > shell, 'achievement repair must be later in the cascade');

  const repairedCss = css.slice(repair);
  assert.match(repairedCss, /#achievementsModal \.achievements-sheet/);
  assert.match(repairedCss, /\.achievement-tile,\s*\.achievement-tile\.rarity-rare,\s*\.achievement-tile\.rarity-epic,\s*\.achievement-tile\.rarity-legendary/);
  assert.match(repairedCss, /\.achievement-tile\.earned/);
  assert.match(repairedCss, /\.achievement-tile\.locked/);
  assert.match(repairedCss, /\.profile-achievement-medal > span/);
  assert.match(repairedCss, /@media \(max-width: 380px\)/);

  assert.doesNotMatch(repairedCss, /#141922|#1a1421|rgba\(69,133,218|rgba\(157,68,218|#ff8095/);
});


test('achievements have one canonical runtime visual source', () => {
  assert.match(index, /styles\.css\?v=20\.10-profile-reference-geometry/);
  assert.doesNotMatch(index, /v22\.css|red-cosmos-v2\.css|black-frosted-glass\.css/);

  assert.match(app, /class="achievement-tile \$\{item\.earned \? 'earned' : 'locked'\} rarity-/);
  assert.doesNotMatch(app, /achievement-card/);

  assert.doesNotMatch(
    css,
    /(?:^|\n)\.achievement-card(?:[\s:{>,.]|$)/m,
    'dead purple achievement-card presentation must not return to canonical runtime CSS'
  );
  assert.doesNotMatch(
    css,
    /rgba\(87,144,214,.25\)|rgba\(179,96,230,.3\)|#141922|#1a1421/,
    'legacy blue/purple rarity presentation must not exist before the white-gold repair'
  );

  const repair = css.indexOf('V20.2.1 · ACHIEVEMENTS WHITE-GOLD REPAIR');
  assert.ok(repair >= 0, 'canonical white-gold achievement block must exist');
  const canonical = css.slice(repair);
  assert.match(canonical, /\.achievement-tile,\s*\.achievement-tile\.rarity-rare,\s*\.achievement-tile\.rarity-epic,\s*\.achievement-tile\.rarity-legendary/);
  assert.match(canonical, /\.achievement-tile\.locked/);
  assert.match(canonical, /\.achievement-tile\.earned/);
  assert.match(canonical, /\.achievement-progress i/);
  assert.match(canonical, /\.achievement-celebration/);
});
