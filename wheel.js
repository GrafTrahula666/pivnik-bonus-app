import crypto from 'node:crypto';

export const WHEEL_TICKET_COUNT = 500_000;
export const WHEEL_JACKPOT_GATE = 2;
export const WHEEL_FREE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const WHEEL_PRIZES = Object.freeze([
  Object.freeze({ code: 'bonus-5', title: '5 бонусов', tickets: 200_000, bonus: 5, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-10', title: '10 бонусов', tickets: 100_000, bonus: 10, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-20', title: '20 бонусов', tickets: 100_000, bonus: 20, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-50', title: '50 бонусов', tickets: 50_000, bonus: 50, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'bonus-100', title: '100 бонусов', tickets: 25_000, bonus: 100, beerMl: 0, annualSupply: false }),
  Object.freeze({ code: 'beer-glass', title: 'Бокал пива', tickets: 24_999, bonus: 0, beerMl: 500, annualSupply: false }),
  Object.freeze({ code: 'annual-beer', title: 'Годовой запас пива', tickets: 1, bonus: 0, beerMl: 0, annualSupply: true })
]);

export const DEFAULT_WHEEL_FIRST_PAID_COST = 50;
export const DEFAULT_WHEEL_NEXT_PAID_COST = 100;
const WHEEL_JACKPOT_CODE = 'annual-beer';
// The jackpot's single ticket is taken from this prize's share; a failed jackpot gate also lands here.
const WHEEL_FALLBACK_CODE = 'beer-glass';
export const HALLOWEEN_TICKET_PRIZE_CODE = 'halloween-ticket';
// While the Halloween theme is published the whole beer-glass share (its chance and the failed-jackpot
// fallback) pays one pumpkin ticket for the Night of Cauldrons draw instead of a glass of beer.
export const HALLOWEEN_TICKET_PRIZE = Object.freeze({
  code: HALLOWEEN_TICKET_PRIZE_CODE, title: 'Хэллоуинский билет', tickets: 0, bonus: 0, beerMl: 0, annualSupply: false, halloweenTicket: true
});
const TICKETS_PER_HUNDREDTH = WHEEL_TICKET_COUNT / 10_000;
const MAX_PAID_COST = 10_000;
const MAX_FREE_INTERVAL_HOURS = 168;

// PIVNIK Business can change the chances of the regular prizes, the paid spin prices and how often
// the free spin returns. Prize amounts stay fixed: the approved wheel artwork pictures them. The
// jackpot always stays 1 in 1,000,000.
function settingsError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function wholeNumber(value, min, max, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw settingsError(`${label}: целое число от ${min} до ${max}.`);
  return parsed;
}

export function normalizeWheelSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const chances = input.chances && typeof input.chances === 'object' ? input.chances : {};
  let totalHundredths = 0;
  const normalizedChances = {};
  for (const prize of WHEEL_PRIZES) {
    if (prize.code === WHEEL_JACKPOT_CODE) continue;
    const value = Number(chances[prize.code]);
    const hundredths = Math.round(value * 100);
    if (!Number.isFinite(value) || value < 0 || value > 100 || Math.abs(hundredths - value * 100) > 1e-6) {
      throw settingsError(`«${prize.title}»: шанс от 0 до 100%, не больше двух знаков после запятой.`);
    }
    totalHundredths += hundredths;
    normalizedChances[prize.code] = hundredths / 100;
  }
  if (totalHundredths !== 10_000) throw settingsError(`Сумма шансов должна быть ровно 100%, сейчас ${(totalHundredths / 100).toLocaleString('ru-RU')}%.`);
  if (normalizedChances[WHEEL_FALLBACK_CODE] <= 0) throw settingsError('У бокала пива шанс должен быть больше 0%: из его доли берётся билет главного приза.');
  const firstPaidCost = wholeNumber(input.firstPaidCost ?? DEFAULT_WHEEL_FIRST_PAID_COST, 1, MAX_PAID_COST, 'Цена первого платного вращения');
  const nextPaidCost = wholeNumber(input.nextPaidCost ?? DEFAULT_WHEEL_NEXT_PAID_COST, 1, MAX_PAID_COST, 'Цена следующих платных вращений');
  const freeIntervalHours = wholeNumber(input.freeIntervalHours ?? 24, 1, MAX_FREE_INTERVAL_HOURS, 'Интервал бесплатного вращения в часах');
  return { chances: normalizedChances, firstPaidCost, nextPaidCost, freeIntervalHours };
}

function prizesFromChances(chances) {
  return Object.freeze(WHEEL_PRIZES.map((prize) => {
    if (prize.code === WHEEL_JACKPOT_CODE) return prize;
    const tickets = Math.round(chances[prize.code] * 100) * TICKETS_PER_HUNDREDTH - (prize.code === WHEEL_FALLBACK_CODE ? 1 : 0);
    return Object.freeze({ ...prize, tickets });
  }));
}

let wheelPrizesValue = WHEEL_PRIZES;
let firstPaidCostValue = DEFAULT_WHEEL_FIRST_PAID_COST;
let nextPaidCostValue = DEFAULT_WHEEL_NEXT_PAID_COST;
let freeIntervalMsValue = WHEEL_FREE_INTERVAL_MS;

// Applies settings read from the database. Broken settings fall back to the defaults.
export function configureWheel(raw) {
  let settings = null;
  try {
    settings = raw ? normalizeWheelSettings(raw) : null;
  } catch (error) {
    console.warn('Wheel settings ignored:', error.message);
  }
  wheelPrizesValue = settings ? prizesFromChances(settings.chances) : WHEEL_PRIZES;
  firstPaidCostValue = settings?.firstPaidCost ?? DEFAULT_WHEEL_FIRST_PAID_COST;
  nextPaidCostValue = settings?.nextPaidCost ?? DEFAULT_WHEEL_NEXT_PAID_COST;
  freeIntervalMsValue = settings ? settings.freeIntervalHours * 60 * 60 * 1000 : WHEEL_FREE_INTERVAL_MS;
}

export function wheelPrizes() {
  return wheelPrizesValue;
}

export function wheelFreeIntervalHours() {
  return freeIntervalMsValue / (60 * 60 * 1000);
}

// What a guest really gets: the failed jackpot gate adds half a ticket to the beer prize.
export function wheelPrizeChances() {
  return wheelPrizesValue.map((prize) => {
    const tickets = prize.annualSupply ? 0.5 : prize.tickets + (prize.code === WHEEL_FALLBACK_CODE ? 0.5 : 0);
    return { code: prize.code, title: prize.title, bonus: prize.bonus, beerMl: prize.beerMl, annualSupply: prize.annualSupply, chancePercent: Number((tickets / WHEEL_TICKET_COUNT * 100).toFixed(4)) };
  });
}

export function wheelSettingsSnapshot() {
  const chances = {};
  for (const prize of wheelPrizesValue) {
    if (prize.annualSupply) continue;
    chances[prize.code] = (prize.tickets + (prize.code === WHEEL_FALLBACK_CODE ? 1 : 0)) / TICKETS_PER_HUNDREDTH / 100;
  }
  return { chances, firstPaidCost: firstPaidCostValue, nextPaidCost: nextPaidCostValue, freeIntervalHours: wheelFreeIntervalHours() };
}

export function selectWheelPrize(ticket) {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket >= WHEEL_TICKET_COUNT) {
    throw new RangeError('Wheel ticket is outside the configured range.');
  }
  let upperBound = 0;
  for (const prize of wheelPrizesValue) {
    upperBound += prize.tickets;
    if (ticket < upperBound) return prize;
  }
  throw new Error('Wheel prize table does not cover every ticket.');
}

export function halloweenWheelPrize(prize, halloween) {
  return halloween && prize?.code === WHEEL_FALLBACK_CODE ? { ...HALLOWEEN_TICKET_PRIZE, tickets: prize.tickets } : prize;
}

export function drawWheelPrize(randomInt = crypto.randomInt, { halloween = false } = {}) {
  const drawn = drawBasePrize(randomInt);
  return { ticket: drawn.ticket, prize: halloweenWheelPrize(drawn.prize, halloween) };
}

function drawBasePrize(randomInt) {
  const ticket = randomInt(0, WHEEL_TICKET_COUNT);
  const candidate = selectWheelPrize(ticket);
  if (!candidate.annualSupply) return { ticket, prize: candidate };

  // The single jackpot candidate ticket is gated once more by an independent
  // cryptographic 50/50 draw: 1/500,000 × 1/2 = exactly 1/1,000,000.
  // A failed gate becomes the ordinary beer prize. Store 499,998 so the
  // persisted ticket remains consistent with selectWheelPrize(ticket).
  const gate = randomInt(0, WHEEL_JACKPOT_GATE);
  if (gate === 0) return { ticket, prize: candidate };
  return {
    ticket: WHEEL_TICKET_COUNT - 2,
    prize: wheelPrizesValue.find((item) => item.code === WHEEL_FALLBACK_CODE)
  };
}

export function freeSpinState(lastFreeSpinAt, now = new Date()) {
  const nowMs = new Date(now).getTime();
  const lastMs = lastFreeSpinAt ? new Date(lastFreeSpinAt).getTime() : Number.NaN;
  if (!Number.isFinite(lastMs)) {
    return { available: true, nextAt: null, remainingMs: 0 };
  }
  const nextMs = lastMs + freeIntervalMsValue;
  return {
    available: nowMs >= nextMs,
    nextAt: new Date(nextMs).toISOString(),
    remainingMs: Math.max(0, nextMs - nowMs)
  };
}

export function paidSpinCost(paidSpinsSinceLastFree) {
  return Number(paidSpinsSinceLastFree || 0) === 0 ? firstPaidCostValue : nextPaidCostValue;
}
