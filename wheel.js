import crypto from 'node:crypto';

export const WHEEL_TICKET_COUNT = 500_000;
export const WHEEL_JACKPOT_GATE = 2;
export const WHEEL_FREE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// The "Бокал пива" slot and the Halloween "Ночь Котлов" ticket are mutually exclusive: only one of
// them is ever in the table, chosen by the `ticketMode` wheel setting (one switch, PIVNIK Business ->
// колесо). Same 24,999-ticket share either way, so toggling it never changes anyone else's chances,
// and the jackpot's own 1-in-1,000,000 math (below) is untouched by which one is active.
const BEER_GLASS_PRIZE = Object.freeze({ code: 'beer-glass', title: 'Бокал пива', tickets: 24_999, bonus: 0, beerMl: 500, annualSupply: false });
const HALLOWEEN_TICKET_PRIZE = Object.freeze({ code: 'halloween-ticket', title: 'Билет «Ночь Котлов»', tickets: 24_999, bonus: 0, beerMl: 0, annualSupply: false, ticket: true });
// Genitive phrasing for the "its share also gives up the jackpot's one ticket" validation message.
const FALLBACK_PHRASE_BY_CODE = Object.freeze({ 'beer-glass': 'бокала пива', 'halloween-ticket': 'билета «Ночь Котлов»' });

function basePrizes(ticketMode) {
  return Object.freeze([
    Object.freeze({ code: 'bonus-5', title: '5 бонусов', tickets: 200_000, bonus: 5, beerMl: 0, annualSupply: false }),
    Object.freeze({ code: 'bonus-10', title: '10 бонусов', tickets: 100_000, bonus: 10, beerMl: 0, annualSupply: false }),
    Object.freeze({ code: 'bonus-20', title: '20 бонусов', tickets: 100_000, bonus: 20, beerMl: 0, annualSupply: false }),
    Object.freeze({ code: 'bonus-50', title: '50 бонусов', tickets: 50_000, bonus: 50, beerMl: 0, annualSupply: false }),
    Object.freeze({ code: 'bonus-100', title: '100 бонусов', tickets: 25_000, bonus: 100, beerMl: 0, annualSupply: false }),
    ticketMode ? HALLOWEEN_TICKET_PRIZE : BEER_GLASS_PRIZE,
    Object.freeze({ code: 'annual-beer', title: 'Годовой запас пива', tickets: 1, bonus: 0, beerMl: 0, annualSupply: true })
  ]);
}

// The classic (non-Halloween) table: the default, and what broken settings fall back to.
export const WHEEL_PRIZES = basePrizes(false);
// Every prize code wheel_spins history can hold, past or present, for display lookups by code alone.
const HISTORICAL_PRIZES = Object.freeze([...WHEEL_PRIZES, HALLOWEEN_TICKET_PRIZE]);

export function wheelPrizeDefinition(code) {
  return wheelPrizesValue.find((item) => item.code === code)
    || HISTORICAL_PRIZES.find((item) => item.code === code)
    || null;
}

export const DEFAULT_WHEEL_FIRST_PAID_COST = 50;
export const DEFAULT_WHEEL_NEXT_PAID_COST = 100;
const WHEEL_JACKPOT_CODE = 'annual-beer';
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
  const ticketMode = Boolean(input.ticketMode);
  const fallbackCode = ticketMode ? 'halloween-ticket' : 'beer-glass';
  const chances = input.chances && typeof input.chances === 'object' ? input.chances : {};
  let totalHundredths = 0;
  const normalizedChances = {};
  for (const prize of basePrizes(ticketMode)) {
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
  if (normalizedChances[fallbackCode] <= 0) throw settingsError(`У ${FALLBACK_PHRASE_BY_CODE[fallbackCode]} шанс должен быть больше 0%: из его доли берётся билет главного приза.`);
  const firstPaidCost = wholeNumber(input.firstPaidCost ?? DEFAULT_WHEEL_FIRST_PAID_COST, 1, MAX_PAID_COST, 'Цена первого платного вращения');
  const nextPaidCost = wholeNumber(input.nextPaidCost ?? DEFAULT_WHEEL_NEXT_PAID_COST, 1, MAX_PAID_COST, 'Цена следующих платных вращений');
  const freeIntervalHours = wholeNumber(input.freeIntervalHours ?? 24, 1, MAX_FREE_INTERVAL_HOURS, 'Интервал бесплатного вращения в часах');
  return { chances: normalizedChances, ticketMode, firstPaidCost, nextPaidCost, freeIntervalHours };
}

function prizesFromChances(chances, ticketMode) {
  const fallbackCode = ticketMode ? 'halloween-ticket' : 'beer-glass';
  return Object.freeze(basePrizes(ticketMode).map((prize) => {
    if (prize.code === WHEEL_JACKPOT_CODE) return prize;
    const tickets = Math.round(chances[prize.code] * 100) * TICKETS_PER_HUNDREDTH - (prize.code === fallbackCode ? 1 : 0);
    return Object.freeze({ ...prize, tickets });
  }));
}

let wheelPrizesValue = WHEEL_PRIZES;
let ticketModeValue = false;
let firstPaidCostValue = DEFAULT_WHEEL_FIRST_PAID_COST;
let nextPaidCostValue = DEFAULT_WHEEL_NEXT_PAID_COST;
let freeIntervalMsValue = WHEEL_FREE_INTERVAL_MS;

// Applies settings read from the database. Broken settings fall back to the defaults (ticketMode off).
export function configureWheel(raw) {
  let settings = null;
  try {
    settings = raw ? normalizeWheelSettings(raw) : null;
  } catch (error) {
    console.warn('Wheel settings ignored:', error.message);
  }
  ticketModeValue = settings?.ticketMode ?? false;
  wheelPrizesValue = settings ? prizesFromChances(settings.chances, settings.ticketMode) : basePrizes(false);
  firstPaidCostValue = settings?.firstPaidCost ?? DEFAULT_WHEEL_FIRST_PAID_COST;
  nextPaidCostValue = settings?.nextPaidCost ?? DEFAULT_WHEEL_NEXT_PAID_COST;
  freeIntervalMsValue = settings ? settings.freeIntervalHours * 60 * 60 * 1000 : WHEEL_FREE_INTERVAL_MS;
}

export function wheelPrizes() {
  return wheelPrizesValue;
}

export function wheelTicketModeActive() {
  return ticketModeValue;
}

export function wheelFreeIntervalHours() {
  return freeIntervalMsValue / (60 * 60 * 1000);
}

// What a guest really gets: the failed jackpot gate adds half a ticket to the active fallback prize
// (beer-glass, or the Halloween ticket while ticketMode is on).
export function wheelPrizeChances() {
  const fallbackCode = ticketModeValue ? 'halloween-ticket' : 'beer-glass';
  return wheelPrizesValue.map((prize) => {
    const tickets = prize.annualSupply ? 0.5 : prize.tickets + (prize.code === fallbackCode ? 0.5 : 0);
    return {
      code: prize.code,
      title: prize.title,
      bonus: prize.bonus,
      beerMl: prize.beerMl,
      annualSupply: prize.annualSupply,
      ticket: Boolean(prize.ticket),
      chancePercent: Number((tickets / WHEEL_TICKET_COUNT * 100).toFixed(4))
    };
  });
}

export function wheelSettingsSnapshot() {
  const fallbackCode = ticketModeValue ? 'halloween-ticket' : 'beer-glass';
  const chances = {};
  for (const prize of wheelPrizesValue) {
    if (prize.annualSupply) continue;
    chances[prize.code] = (prize.tickets + (prize.code === fallbackCode ? 1 : 0)) / TICKETS_PER_HUNDREDTH / 100;
  }
  return {
    chances,
    ticketMode: ticketModeValue,
    firstPaidCost: firstPaidCostValue,
    nextPaidCost: nextPaidCostValue,
    freeIntervalHours: wheelFreeIntervalHours()
  };
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

export function drawWheelPrize(randomInt = crypto.randomInt) {
  const ticket = randomInt(0, WHEEL_TICKET_COUNT);
  const candidate = selectWheelPrize(ticket);
  if (!candidate.annualSupply) return { ticket, prize: candidate };

  // The single jackpot candidate ticket is gated once more by an independent
  // cryptographic 50/50 draw: 1/500,000 × 1/2 = exactly 1/1,000,000.
  // A failed gate becomes the ordinary beer prize. Store 499,998 so the
  // persisted ticket remains consistent with selectWheelPrize(ticket).
  const gate = randomInt(0, WHEEL_JACKPOT_GATE);
  if (gate === 0) return { ticket, prize: candidate };
  const fallbackCode = ticketModeValue ? 'halloween-ticket' : 'beer-glass';
  return {
    ticket: WHEEL_TICKET_COUNT - 2,
    prize: wheelPrizesValue.find((item) => item.code === fallbackCode)
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
