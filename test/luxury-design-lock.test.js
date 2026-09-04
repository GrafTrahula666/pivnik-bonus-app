import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function applyDesignSource() {
  const start = appSource.indexOf('function applyDesign(design) {');
  const end = appSource.indexOf('\nfunction renderBeer(', start);
  assert.notEqual(start, -1, 'applyDesign() must exist');
  assert.notEqual(end, -1, 'renderBeer() anchor must exist after applyDesign()');
  return appSource.slice(start, end);
}

test('server design cannot overwrite Luxury VIP Space visual colors', () => {
  const source = applyDesignSource();

  assert.match(source, /state\.design = deepClone\(design\)/, 'server design data must still be stored');
  assert.match(source, /Object\.entries\(design\.sections \|\| \{\}\)/, 'section visibility must still be applied');
  assert.match(source, /design\.texts\?\.brand/, 'server-managed copy must still be applied');
  assert.doesNotMatch(source, /root\.style\.setProperty\(/, 'server payload must not rewrite CSS custom properties');
  assert.doesNotMatch(source, /const colors = design\.colors/, 'applyDesign must not consume legacy server colors');
  assert.match(source, /background: '#050609'/, 'fixed Luxury background must be preserved for platform chrome');
  assert.match(source, /header: '#06070a'/, 'fixed Luxury header must be preserved for platform chrome');
  assert.match(source, /setHeaderColor\(platformUiColors\.header\)/);
  assert.match(source, /setBackgroundColor\(platformUiColors\.background\)/);
});
