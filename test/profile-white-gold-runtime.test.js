import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

test('Profile runtime stays on the canonical white-gold stylesheet and real profile DOM', async () => {
  const [index, app] = await Promise.all([read('index.html'), read('app.js')]);

  assert.match(index, /<link rel="stylesheet" href="styles\.css\?v=[^"]+"\s*\/>/);
  assert.doesNotMatch(index, /(?:v22|red-cosmos-v2|black-frosted-(?:glass|surfaces|controls))\.css/);
  assert.match(index, /data-screen="profile"/);
  assert.match(index, /class="profile-identity-card vip-glass-card"/);
  assert.match(index, /class="profile-shortcuts"/);
  assert.match(index, /class="profile-menu vip-glass-card"/);

  assert.match(app, /id="profileSetupModal"/);
  assert.match(app, /class="primary-avatar-choice"/);
  assert.match(app, /class="secondary-avatar-choice"/);
  assert.match(app, /class="privacy-switches"/);
  assert.match(app, /id="animalPickerModal"/);
});

test('Profile setup and settings controls no longer inherit the legacy dark surface palette', async () => {
  const css = await read('styles.css');

  const primaryAvatar = cssBlock(css, '.primary-avatar-choice');
  const secondaryAvatar = cssBlock(css, '.secondary-avatar-choice');
  const selectedAvatar = cssBlock(css, '.selected-avatar-line');
  const ageOption = cssBlock(css, '.age-option-grid button');
  const privacyLabel = cssBlock(css, '.privacy-switches label');
  const animalAvatar = cssBlock(css, '.animal-avatar-choice');
  const frameChoice = cssBlock(css, '.profile-frame-choice');

  for (const [name, block] of Object.entries({
    primaryAvatar,
    secondaryAvatar,
    selectedAvatar,
    ageOption,
    privacyLabel,
    animalAvatar,
    frameChoice
  })) {
    assert.ok(block, `${name} CSS block must exist`);
    assert.doesNotMatch(block, /background:\s*rgba\(0,\s*0,\s*0,/i, `${name} must not use a black profile surface`);
  }

  assert.match(primaryAvatar, /background:\s*rgba\(255,252,247,\.94\)/);
  assert.match(secondaryAvatar, /background:\s*rgba\(255,252,247,\.94\)/);
  assert.match(selectedAvatar, /background:\s*rgba\(255,252,247,\.88\)/);
  assert.match(privacyLabel, /background:\s*rgba\(255,252,247,\.90\)/);
  assert.match(frameChoice, /background:\s*rgba\(255,252,247,\.94\)/);
});

test('Profile page and modal contrast is explicitly white-gold while danger stays semantic only', async () => {
  const css = await read('styles.css');

  assert.match(cssBlock(css, '.profile-menu > button'), /color:\s*#2b241c/);
  assert.match(cssBlock(css, '.profile-stats-grid strong'), /color:\s*#9b650f/);
  assert.match(cssBlock(css, '.privacy-switches input[type="checkbox"]'), /accent-color:\s*#b57918/);

  const deleteSheet = cssBlock(css, '.delete-account-sheet');
  assert.match(deleteSheet, /linear-gradient\(180deg,\s*rgba\(255,253,248,\.99\),\s*rgba\(247,240,229,\.99\)\)/);
  assert.doesNotMatch(deleteSheet, /#190b0e|#0a0708/i);

  for (const id of ['profileSetupModal', 'animalPickerModal', 'profileStatsModal', 'notificationsModal', 'deleteAccountModal']) {
    assert.match(css, new RegExp(`#${id} \\.close`));
  }

  assert.match(css, /\.service-access \.primary,[\s\S]*?#profileSetupModal \.primary,[\s\S]*?#notificationsModal \.primary/);
  assert.match(css, /\.service-access \.secondary[\s\S]*?color:\s*#85540a/);
});
