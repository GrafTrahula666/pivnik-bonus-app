import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');

function sourceBetween(start, end) {
  const startIndex = appSource.indexOf(start);
  const endIndex = appSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0, `Missing source marker: ${start}`);
  assert.ok(endIndex > startIndex, `Missing source marker: ${end}`);
  return appSource.slice(startIndex, endIndex);
}

function createTab(rarity) {
  const classes = new Set(rarity === 'common' ? ['active'] : []);
  const attributes = new Map();
  return {
    dataset: { achievementTab: rarity },
    classList: {
      contains: (name) => classes.has(name),
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
    tabIndex: rarity === 'common' ? 0 : -1,
    focus() {}
  };
}

test('each achievement rarity press changes both the selected tab and catalog content', () => {
  const rarities = ['common', 'rare', 'epic', 'legendary'];
  const tabs = rarities.map(createTab);
  const catalog = { innerHTML: '' };
  const state = {
    achievementTab: 'common',
    achievementsLoaded: true,
    achievements: rarities.slice(0, 3).map((rarity) => ({
      code: `${rarity}-item`,
      title: `${rarity}-title`,
      description: `${rarity}-description`,
      rarity,
      earned: false,
      progress: { percent: 25, label: `${rarity}-progress` }
    })),
    profile: {
      achievements: [{
        code: 'legendary-item',
        title: 'legendary-title',
        description: 'legendary-description',
        rarity: 'legendary'
      }]
    }
  };

  let now = 1000;
  const context = {
    state,
    Set,
    performance: { now: () => now },
    escapeHtml: (value) => String(value ?? ''),
    fmt: (value) => String(value ?? ''),
    achievementRarityLabel: (rarity) => rarity,
    achievementIconHtml: () => '◆',
    achievementRewardLabel: () => 'Награда',
    $$: (selector) => selector.includes('data-achievement-tab') ? tabs : [],
    $: (selector) => {
      if (selector === '#achievementCatalog') return catalog;
      const match = selector.match(/data-achievement-tab="([^"]+)"/);
      return match ? tabs.find((tab) => tab.dataset.achievementTab === match[1]) : null;
    }
  };

  const renderSource = sourceBetween('function renderAchievementCatalog()', 'function openAchievements(');
  const interactionSource = sourceBetween('const achievementRarities', 'function navigateAchievementTabs(');
  vm.runInNewContext(`${renderSource}\n${interactionSource}\nthis.activateAchievementTab = activateAchievementTab;`, context);

  for (const rarity of rarities) {
    let prevented = false;
    const button = tabs.find((tab) => tab.dataset.achievementTab === rarity);
    context.activateAchievementTab({
      type: 'pointerup',
      target: { closest: () => button },
      preventDefault: () => { prevented = true; }
    });

    assert.equal(prevented, true);
    assert.equal(state.achievementTab, rarity);
    assert.match(catalog.innerHTML, new RegExp(`${rarity}-title`));
    for (const tab of tabs) {
      const selected = tab.dataset.achievementTab === rarity;
      assert.equal(tab.classList.contains('active'), selected);
      assert.equal(tab.getAttribute('aria-selected'), selected ? 'true' : 'false');
      assert.equal(tab.tabIndex, selected ? 0 : -1);
    }
    now += 600;
  }
});
