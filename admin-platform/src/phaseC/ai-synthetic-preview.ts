/**
 * CHAT 14 / 134. Pure, static SAMPLE of a potential future analyst response.
 * No provider, prompt, database, real customer data, HTTP call or inference.
 * This fixture is safe to render ONLY in existing demo mode.
 */
export const SYNTHETIC_AI_PREVIEW = {
  schemaVersion: 1,
  mode: 'synthetic',
  source: 'bundled-static-fixture',
  provider: 'none',
  externalRequests: 0,
  usesRealVenueData: false,
  generatedByModel: false,
  periodLabel: 'Учебные недели А и Б',
  examples: [
    {
      id: 'trend',
      title: 'Изменение продаж',
      status: 'example',
      observed: 'В тестовом примере сумма продаж за неделю Б ниже недели А.',
      evidence: 'Учебные данные. Источник: встроенный фикстурный набор.',
      limitation: 'Не устанавливает причину падения и не означает снижение прибыли.',
      action: 'После подключения источника сравнить одинаковые календарные периоды.',
    },
    {
      id: 'anomaly',
      title: 'Необычные часы',
      status: 'insufficient_data',
      observed: 'Недостаточно данных для определения аномалии.',
      evidence: 'Учебный пример без подтверждённой истории часов.',
      limitation: 'Одинаковые часы нескольких дней нельзя считать отдельными точками временного ряда.',
      action: 'Сначала проверить полноту данных и сопоставимый исторический период.',
    },
    {
      id: 'recommendation',
      title: 'Возможное действие',
      status: 'hypothesis',
      observed: 'Гипотеза: проверить ассортимент и график в слабые дни.',
      evidence: 'Учебный сценарий, а не вывод об этом заведении.',
      limitation: 'Ни эффект, ни окупаемость не рассчитаны. Это не автоматическая рекомендация модели.',
      action: 'Сформулировать небольшой эксперимент и измерить результат на проверенных данных.',
    },
  ],
} as const

export type SyntheticAiPreview = typeof SYNTHETIC_AI_PREVIEW
