import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('canonical profile preserves QR and separate live data zones', async () => {
  const css = await read('home-canonical.css');
  assert.match(css, /\.hero-qr-button \{[\s\S]*?width:\s*30px\s*!important[\s\S]*?height:\s*30px\s*!important/);
  assert.match(css, /\.client-name \{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(css, /\.balance \{[\s\S]*?top:\s*35\.5%/);
  assert.match(css, /\.status-button \{[\s\S]*?top:\s*60\.5%/);
  assert.match(css, /\.max-status-line \{[\s\S]*?bottom:\s*4\.1%/);
});

test('approved astronaut and approved wheel are the Home visual assets', async () => {
  const css = await read('home-canonical.css');
  assert.match(css, /business-astronaut-approved\.webp\?v=canonical-1/);
  assert.match(css, /wheel-approved\.webp\?v=canonical-1/);
  assert.match(css, /\.home-wheel-ring \{[\s\S]*?display:\s*none\s*!important/);
});

test('all Home cards share one edge grid', async () => {
  const css = await read('home-canonical.css');
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /justify-self:\s*stretch/);
  assert.match(css, /width:\s*100%\s*!important/);
});
