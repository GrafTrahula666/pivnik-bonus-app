import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('renderBeer updates all 14 beer progress segments without throwing', async () => {
  const source = await readFile(new URL('app.js', root), 'utf8');
  const body = source
    .match(/function renderBeer\([\s\S]*?\n}\n\nfunction imageMarkup/)?.[0]
    .replace(/\n\nfunction imageMarkup$/, '');
  assert.ok(body, 'renderBeer must be available');

  const segments = Array.from({ length: 14 }, () => ({
    style: { setProperty(name, value) { this[name] = value; } },
    classList: { toggle() {} }
  }));
  const nodes = new Map();
  for (const id of [
    'beerProgressBar',
    'beerProgressText',
    'beerRemainingText',
    'beerGiftBalance',
    'beerGiftReady',
    'beerLoyaltyCard'
  ]) {
    nodes.set(`#${id}`, {
      textContent: '',
      setAttribute() {},
      classList: { toggle() {} }
    });
  }

  const context = {
    $: (selector) => nodes.get(selector),
    $$: (selector) => selector === '#beerProgressBar .beer-progress-segment' ? segments : [],
    fmtLiters: String
  };
  const render = runInNewContext(`${body}; renderBeer`, context);

  assert.doesNotThrow(() => render({
    beer: {
      paidTargetLiters: 14,
      progressLiters: 2.5,
      nextGiftLiters: 11.5,
      giftLitersBalance: 1
    }
  }));
  assert.equal(segments[0].style['--segment-fill'], '100%');
  assert.equal(segments[1].style['--segment-fill'], '100%');
  assert.equal(segments[2].style['--segment-fill'], '50%');
  assert.equal(segments[3].style['--segment-fill'], '0%');
  assert.equal(nodes.get('#beerGiftBalance').textContent, '1');
});
