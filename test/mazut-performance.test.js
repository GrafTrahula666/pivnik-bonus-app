import test from 'node:test';
import assert from 'node:assert/strict';
import { getMazutRenderQuality } from '../assets/home-mazut/fluid.js';
import { createMazutInk } from '../assets/home-mazut/ink.js';

const root = (tier, lite = false) => ({
  dataset: tier ? { pivnikPerformance: tier } : {},
  classList: { contains(name) { return name === 'lite-mode' && lite; } }
});
const phone = (userAgent, memory, cores) => ({
  userAgent, deviceMemory: memory, hardwareConcurrency: cores
});

test('high Android and iOS preserve approved fluid render quality', () => {
  const high = getMazutRenderQuality(root('high'), phone('Android 15', 8, 8));
  const ios = getMazutRenderQuality(root(), phone('iPhone', undefined, undefined));
  assert.equal(high.quality, 'high');
  assert.equal(ios.quality, 'high');
  assert.equal(high.spacing, 15.3);
  assert.equal(high.step, 1 / 60);
  assert.equal(high.maxDpr, 2);
  assert.equal(high.renderInterval, 16);
});

test('the lower quality presets have bounded paint and physics budgets', () => {
  const high = getMazutRenderQuality(root('high'), phone('Android', 8, 8));
  const balanced = getMazutRenderQuality(root('balanced'), phone('Android', 4, 8));
  const low = getMazutRenderQuality(root('low'), phone('Android', 2, 4));
  assert.ok(high.maxPixels > balanced.maxPixels && balanced.maxPixels > low.maxPixels);
  assert.ok(high.renderInterval < balanced.renderInterval && balanced.renderInterval < low.renderInterval);
  assert.ok(high.spacing < balanced.spacing && balanced.spacing < low.spacing);
  assert.ok(high.step < balanced.step && balanced.step < low.step);
  assert.ok(high.sampleInterval < balanced.sampleInterval && balanced.sampleInterval < low.sampleInterval);
});

test('without app bootstrap, Telegram class and device hints still choose safe budgets', () => {
  const tag = 'Mozilla/5.0 (Linux; Android 15) Telegram-Android/12.0 (Samsung S25; Android 15; SDK 35; HIGH)';
  assert.equal(getMazutRenderQuality(root(), phone(tag)).quality, 'high');
  assert.equal(getMazutRenderQuality(root(), phone('Android', 8, 8)).quality, 'high');
  assert.equal(getMazutRenderQuality(root(), phone('Android')).quality, 'balanced');
  assert.equal(getMazutRenderQuality(root(), phone('Android', 2, 8)).quality, 'low');
  assert.equal(getMazutRenderQuality(root(), phone(tag, 8, 8)).quality, 'high');
  assert.equal(getMazutRenderQuality(root('high', true), phone(tag, 8, 8)).quality, 'low');
});

test('paint-sampling interval prevents redundant DOM changes while preserving hysteresis', () => {
  const attributes = new Set();
  const rect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  const canvas = { getBoundingClientRect: rect };
  const element = {
    getBoundingClientRect: rect,
    hasAttribute: name => attributes.has(name),
    toggleAttribute(name, on) {
      if (on) attributes.add(name);
      else attributes.delete(name);
    }
  };
  const packed = {
    width: 100, height: 100, radius: 35,
    x: new Float32Array([50, 50, 50]), y: new Float32Array([50, 50, 50]),
    oldX: new Float32Array([50, 50, 50]), oldY: new Float32Array([50, 50, 50]),
    blend: 1
  };
  const empty = { ...packed, x: new Float32Array(), y: new Float32Array(),
    oldX: new Float32Array(), oldY: new Float32Array() };
  const sample = createMazutInk(canvas, [element], 999999);
  sample(packed);
  assert.equal(attributes.has('data-mazut-over'), true);
  sample(empty);
  assert.equal(attributes.has('data-mazut-over'), true);
  createMazutInk(canvas, [element], 0)(empty);
  assert.equal(attributes.has('data-mazut-over'), false);
});
