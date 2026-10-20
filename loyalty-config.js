// Guest status levels and the welcome bonus. PIVNIK Business can change them; without saved
// settings these defaults apply.

export const DEFAULT_STATUS_LEVELS = Object.freeze([
  { minCents: 0, name: 'Путник', bonusPercent: 5, discountPercent: 0 },
  { minCents: 1_000_000, name: 'Странник', bonusPercent: 6, discountPercent: 0 },
  { minCents: 3_000_000, name: 'Гость таверны', bonusPercent: 7, discountPercent: 0 },
  { minCents: 7_000_000, name: 'Завсегдатай', bonusPercent: 8, discountPercent: 0 },
  { minCents: 10_000_000, name: 'Местный пьяница', bonusPercent: 9, discountPercent: 0 },
  { minCents: 15_000_000, name: 'Легендарный пьяница', bonusPercent: 10, discountPercent: 0 },
  { minCents: 50_000_000, name: 'Король Пивника', bonusPercent: 20, discountPercent: 10 }
].map((level) => Object.freeze(level)));
export const DEFAULT_WELCOME_BONUS = 100;

const MAX_LEVELS = 12;
const MAX_PERCENT = 50;
const MAX_WELCOME_BONUS = 10_000;
const MAX_THRESHOLD_CENTS = 10_000_000_00;

function settingsError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

// nextCents is derived, so the levels always form one ladder.
function withNext(levels) {
  return Object.freeze(levels.map((level, index) => Object.freeze({
    ...level,
    nextCents: levels[index + 1]?.minCents ?? null
  })));
}

function percent(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_PERCENT || Math.round(parsed * 10) !== parsed * 10) {
    throw settingsError(`${label}: от 0 до ${MAX_PERCENT}%, не больше одного знака после запятой.`);
  }
  return parsed;
}

export function normalizeLoyaltySettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const rawLevels = Array.isArray(input.levels) ? input.levels : [];
  if (rawLevels.length < 1 || rawLevels.length > MAX_LEVELS) throw settingsError(`Нужно от 1 до ${MAX_LEVELS} уровней.`);
  const levels = rawLevels.map((value, index) => {
    const item = value && typeof value === 'object' ? value : {};
    const name = String(item.name || '').trim();
    if (!name || name.length > 40) throw settingsError(`Уровень ${index + 1}: название от 1 до 40 символов.`);
    const minCents = Number(item.minCents);
    if (!Number.isSafeInteger(minCents) || minCents < 0 || minCents > MAX_THRESHOLD_CENTS || minCents % 100 !== 0) {
      throw settingsError(`«${name}»: порог в целых рублях.`);
    }
    return {
      minCents,
      name,
      bonusPercent: percent(item.bonusPercent, `«${name}», начисление`),
      discountPercent: percent(item.discountPercent ?? 0, `«${name}», скидка`)
    };
  });
  if (levels[0].minCents !== 0) throw settingsError('Первый уровень должен начинаться с 0 ₽.');
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index].minCents <= levels[index - 1].minCents) throw settingsError('Пороги уровней должны расти по порядку.');
  }
  if (new Set(levels.map((level) => level.name.toLowerCase())).size !== levels.length) throw settingsError('Названия уровней не должны повторяться.');
  const welcomeBonus = Number(input.welcomeBonus ?? DEFAULT_WELCOME_BONUS);
  if (!Number.isSafeInteger(welcomeBonus) || welcomeBonus < 0 || welcomeBonus > MAX_WELCOME_BONUS) {
    throw settingsError(`Приветственный бонус: от 0 до ${MAX_WELCOME_BONUS}.`);
  }
  return { levels, welcomeBonus };
}

let statusLevelsValue = withNext(DEFAULT_STATUS_LEVELS);
let welcomeBonusValue = DEFAULT_WELCOME_BONUS;

// Applies settings read from the database. Broken settings fall back to the defaults.
export function configureLoyalty(raw) {
  try {
    const settings = raw ? normalizeLoyaltySettings(raw) : { levels: DEFAULT_STATUS_LEVELS, welcomeBonus: DEFAULT_WELCOME_BONUS };
    statusLevelsValue = withNext(settings.levels);
    welcomeBonusValue = settings.welcomeBonus;
  } catch (error) {
    console.warn('Loyalty settings ignored:', error.message);
    statusLevelsValue = withNext(DEFAULT_STATUS_LEVELS);
    welcomeBonusValue = DEFAULT_WELCOME_BONUS;
  }
}

export function statusLevels() {
  return statusLevelsValue;
}

export function welcomeBonusAmount() {
  return welcomeBonusValue;
}

export function statusForSpend(spendCents) {
  const levels = statusLevelsValue;
  return [...levels].reverse().find((item) => spendCents >= item.minCents) || levels[0];
}

export function topStatus() {
  return statusLevelsValue[statusLevelsValue.length - 1];
}
