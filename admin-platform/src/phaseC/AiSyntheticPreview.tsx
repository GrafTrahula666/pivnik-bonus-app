import { SYNTHETIC_AI_PREVIEW } from './ai-synthetic-preview'
import './ai-synthetic-preview.css'

const statusText = {
  example: 'Тестовый факт',
  insufficient_data: 'Недостаточно данных',
  hypothesis: 'Гипотеза',
} as const

/**
 * Static concept. Render only inside DemoMode, never from a live venue report.
 * Nothing here calls a model, an API or a backend adapter.
 */
export function AiSyntheticPreview() {
  return (
    <section className="card synthetic-ai-preview" aria-label="Тестовый макет аналитических подсказок">
      <header className="synthetic-ai-head">
        <div>
          <span className="synthetic-ai-eyebrow">SPACEVERSE · ЛАБОРАТОРИЯ</span>
          <h2>Предпросмотр аналитических подсказок</h2>
          <p>Фиксированный пример будущего интерфейса. Здесь нет AI-модели, прогнозов или настоящих данных заведения.</p>
        </div>
        <span className="synthetic-ai-badge">СИНТЕТИЧЕСКИЕ ДАННЫЕ</span>
      </header>
      <p className="synthetic-ai-source">
        Режим: <strong>{SYNTHETIC_AI_PREVIEW.mode}</strong> · Источник: локальный тестовый набор ·
        Внешние API-запросы: <strong>{SYNTHETIC_AI_PREVIEW.externalRequests}</strong>
      </p>
      <div className="synthetic-ai-grid">
        {SYNTHETIC_AI_PREVIEW.examples.map(example => (
          <article className="synthetic-ai-example" key={example.id}>
            <span className="synthetic-ai-status">{statusText[example.status]}</span>
            <h3>{example.title}</h3>
            <p className="synthetic-ai-observation">{example.observed}</p>
            <dl>
              <div><dt>Основание</dt><dd>{example.evidence}</dd></div>
              <div><dt>Ограничение</dt><dd>{example.limitation}</dd></div>
              <div><dt>Что проверить</dt><dd>{example.action}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <p className="synthetic-ai-foot">
        Только демонстрация. Реальный AI выключен; включение доступа, выбор провайдера и стоимость не настроены.
        Никаких рекомендаций на основании данных вашего бизнеса здесь нет.
      </p>
    </section>
  )
}
