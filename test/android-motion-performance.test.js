import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(root, 'app.js'), 'utf8');
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
const end = app.indexOf('\nfunction readTelegramLaunchData()');
assert.ok(end > 0, 'the real app bootstrap must remain identifiable');
const bootstrap = app.slice(0, end);

function boot({ userAgent, deviceMemory, hardwareConcurrency, lite = false } = {}) {
  const classes = new Map();
  const doc = {
    dataset: {},
    classList: {
      toggle(className, enabled) { classes.set(className, enabled); }
    }
  };
  const context = {
    navigator: { userAgent: userAgent || '', deviceMemory, hardwareConcurrency },
    document: { documentElement: doc },
    location: { search: lite ? '?lite=1' : '', hash: '' },
    window: { __PIVNIK_PLATFORM__: 'telegram' },
    URLSearchParams
  };
  vm.runInNewContext(`function readTelegramLaunchData() { return ''; }\n${bootstrap}`, context);
  return { tier: doc.dataset.pivnikPerformance, classes };
}

test('a Telegram Android HIGH class retains motion even when browser hints are absent', () => {
  const state = boot({
    userAgent: 'Mozilla/5.0 (Linux; Android 15) Telegram-Android/12.0 (Samsung S25; Android 15; SDK 35; HIGH)'
  });
  assert.equal(state.tier, 'high');
  assert.equal(state.classes.get('android-webview'), true);
  assert.equal(state.classes.get('reduce-effects'), false);
});

test('low Android class retains original safe effects mode', () => {
  const state = boot({
    userAgent: 'Mozilla/5.0 (Linux; Android 12) Telegram-Android/11.3.3 (Redmi 9; Android 12; SDK 31; LOW)'
  });
  assert.equal(state.tier, 'low');
  assert.equal(state.classes.get('reduce-effects'), true);
});

test('browser performance hints select high, balanced and low tiers conservatively', () => {
  const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36';
  assert.equal(boot({ userAgent: android, deviceMemory: 8, hardwareConcurrency: 8 }).tier, 'high');
  assert.equal(boot({ userAgent: android, deviceMemory: 4, hardwareConcurrency: 8 }).tier, 'balanced');
  assert.equal(boot({ userAgent: android }).tier, 'balanced');
  assert.equal(boot({ userAgent: android, deviceMemory: 2, hardwareConcurrency: 8 }).tier, 'low');
  assert.equal(boot({ userAgent: android, deviceMemory: 8, hardwareConcurrency: 4 }).tier, 'low');
});

test('Telegram AVERAGE is balanced and explicit device class overrides sparse hints', () => {
  const agent = 'Mozilla/5.0 (Linux; Android 14) Telegram-Android/12 (Phone; Android 14; SDK 34; AVERAGE)';
  const state = boot({ userAgent: agent, deviceMemory: 2, hardwareConcurrency: 4 });
  assert.equal(state.tier, 'balanced');
  assert.equal(state.classes.get('reduce-effects'), false);
});

test('lite opt-in overrides high quality; iOS remains unaffected', () => {
  const android = boot({ userAgent: 'Android', deviceMemory: 8, hardwareConcurrency: 8, lite: true });
  assert.equal(android.tier, 'high');
  assert.equal(android.classes.get('lite-mode'), true);
  assert.equal(android.classes.get('reduce-effects'), true);
  const ios = boot({ userAgent: 'iPhone', deviceMemory: 2, hardwareConcurrency: 2 });
  assert.equal(ios.tier, 'high');
  assert.equal(ios.classes.get('android-webview'), false);
  assert.equal(ios.classes.get('reduce-effects'), false);
});

test('GPU-heavy Android CSS fallbacks target reduced effects, not all Android devices', () => {
  assert.match(css, /\.android-webview\.reduce-effects \* \{\s*backdrop-filter: none !important;/);
  assert.match(css, /\.android-webview\.reduce-effects \.achievement-tile\.locked::after/);
  assert.doesNotMatch(css, /\.android-webview \* \{\s*backdrop-filter: none !important;/);
  assert.match(css, /\.lite-mode \* \{/);
});
