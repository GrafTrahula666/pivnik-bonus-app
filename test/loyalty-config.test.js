import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureLoyalty,
  DEFAULT_STATUS_LEVELS,
  normalizeLoyaltySettings,
  statusForSpend,
  statusLevels,
  topStatus,
  welcomeBonusAmount
} from '../loyalty-config.js';

test.afterEach(() => configureLoyalty(null));

test('Defaults match the levels the app always had', () => {
  assert.equal(statusLevels().length, 7);
  assert.equal(statusForSpend(0).name, 'Путник');
  assert.equal(statusForSpend(1_000_000).bonusPercent, 6);
  assert.equal(statusForSpend(49_999_999).name, 'Легендарный пьяница');
  assert.equal(topStatus().discountPercent, 10);
  assert.equal(statusLevels()[0].nextCents, 1_000_000);
  assert.equal(topStatus().nextCents, null);
  assert.equal(welcomeBonusAmount(), 100);
  assert.equal(DEFAULT_STATUS_LEVELS.length, 7);
});

test('Business levels apply and broken ones fall back to defaults', () => {
  configureLoyalty({ welcomeBonus: 0, levels: [
    { name: 'Новичок', minCents: 0, bonusPercent: 3 },
    { name: 'Свой', minCents: 500_000, bonusPercent: 7.5, discountPercent: 5 }
  ] });
  assert.equal(statusForSpend(499_999).name, 'Новичок');
  assert.equal(statusForSpend(500_000).bonusPercent, 7.5);
  assert.equal(statusLevels()[0].nextCents, 500_000);
  assert.equal(welcomeBonusAmount(), 0);

  configureLoyalty({ levels: [{ name: 'X', minCents: 100, bonusPercent: 5 }] });
  assert.equal(statusLevels().length, 7);
  assert.equal(welcomeBonusAmount(), 100);
});

test('Validation explains what is wrong', () => {
  const level = (name, minCents, bonusPercent = 5) => ({ name, minCents, bonusPercent });
  assert.throws(() => normalizeLoyaltySettings({ levels: [] }), /уровней/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 100)] }), /0 ₽/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 0), level('B', 0)] }), /расти/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 0), level('a', 100)] }), /повторяться/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 0, 60)] }), /до 50%/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 0, 5.25)] }), /знака/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 0)], welcomeBonus: -1 }), /Приветственный/);
  assert.throws(() => normalizeLoyaltySettings({ levels: [level('A', 50)] }), /0 ₽|рублях/);
});
