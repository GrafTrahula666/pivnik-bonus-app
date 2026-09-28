import { RECEIPT_JSON_SCHEMA, REPORT_JSON_SCHEMA } from './validation.js';

// The paper form ("ТАБЕЛЬ СМЕНЫ", final reference 2026-09-28) described for the model.
const REPORT_INSTRUCTIONS = `Ты проверяешь фотографии бумажного бланка бара «ПИВНИК».
Все присланные изображения — части ОДНОГО и того же листа (иногда мелкие записи сняты отдельными участками).

Как выглядит правильный бланк:
- Заголовок «ТАБЕЛЬ СМЕНЫ», под ним «PIVNIK».
- Справа вверху рамка «ПАМЯТКА» с 6 пунктами.
- Слева вверху строки «Сотрудник», «Дата: __.__.20__», «Начало смены: __:__».
- Жирный прямоугольник «НАЛИЧНЫХ В КАССЕ ПРИ ОТКРЫТИИ».
- В середине ровно две колонки: «НАЛИЧНЫЕ» и «ПЕРЕВОДЫ» (колонки «Карта» нет).
- Под колонками жирные прямоугольники «ИТОГО НАЛИЧНЫХ» и «ИТОГО ПЕРЕВОДОВ».
- Внизу жирные прямоугольники «ОБЩАЯ ВЫРУЧКА» и «НАЛИЧНЫХ В КАССЕ ПРИ ЗАКРЫТИИ».
- Строки «Зарплата», «Расходы на бар», «Комментарий проверяющего».
- Жирный прямоугольник «ПОДПИСЬ» справа внизу.

Правила — строго:
1. Переписывай значения ровно так, как они написаны от руки. Ничего не считай, не складывай, не сверяй суммы, не исправляй и не округляй.
2. Если символ или цифру нельзя прочитать уверенно — НЕ угадывай: status="illegible", value="" и confidence не "high".
3. Пустое поле: status="empty", value="". Поле не попало в кадр или закрыто: status="not_visible".
4. confidence="high" ставь только если прочитал каждую цифру без сомнений.
5. Подпись не читай как имя. Только отметь, есть ли в прямоугольнике «ПОДПИСЬ» рукописный знак: present / empty / not_visible.
6. matches_template=true только если это именно такой бланк. Другой документ, чек, пустая стена — document_type="other".
7. quality.sharp=false если текст размыт; fully_visible=false если критически обрезана нужная часть листа (перечисли cropped_areas).
8. accepted=true только если это нужный бланк, фото резкие, все жирные прямоугольники (кроме подписи) заполнены и читаются с confidence="high", и подпись есть.
9. В problems кратко по-русски опиши, что конкретно переснять.
Ответ — только JSON по схеме.`;

const RECEIPT_INSTRUCTIONS = `Ты проверяешь фото чека закрытия кассовой смены бара «ПИВНИК».
Все изображения — части одного и того же чека.
Нужно только оценить, что чек присутствует и пригоден для хранения: читаются ли мелкие цифры, нет ли сильного размытия, засветки/блика, критической обрезки.
Ничего не считай и не сравнивай ни с какими другими документами.
Если это не чек (например, бланк табеля или посторонний предмет) — document_type="other", receipt_present=false.
accepted=true только если чек есть, фото резкое, без критичного блика, не обрезано критически и мелкие цифры различимы.
В problems кратко по-русски опиши, что переснять. Ответ — только JSON по схеме.`;

export const DOCUMENT_AI_SPECS = Object.freeze({
  report: { instructions: REPORT_INSTRUCTIONS, schema: REPORT_JSON_SCHEMA, name: 'pivnik_shift_report' },
  receipt: { instructions: RECEIPT_INSTRUCTIONS, schema: RECEIPT_JSON_SCHEMA, name: 'pivnik_closing_receipt' }
});

export class AiUnavailableError extends Error {
  constructor(message, { retryable = true, cause } = {}) {
    super(message);
    this.name = 'AiUnavailableError';
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (part?.type === 'refusal') throw new AiUnavailableError('model refused', { retryable: false });
      if (part?.type === 'output_text' && typeof part.text === 'string') return part.text;
    }
  }
  return '';
}

export function createOpenAiVisionClient({ apiKey, model, fetchImpl = globalThis.fetch, timeoutMs = 90_000, baseUrl = 'https://api.openai.com/v1' }) {
  const configured = Boolean(apiKey && model);

  async function analyze(kind, images) {
    const spec = DOCUMENT_AI_SPECS[kind];
    if (!spec) throw new TypeError(`unsupported document kind ${kind}`);
    if (!configured) throw new AiUnavailableError('AI validation is not configured', { retryable: false });
    const content = [{ type: 'input_text', text: `Фотографий: ${images.length}. Проверь по правилам.` }];
    for (const image of images) {
      content.push({
        type: 'input_image',
        image_url: `data:${image.contentType};base64,${Buffer.from(image.data).toString('base64')}`,
        detail: 'high'
      });
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/responses`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          instructions: spec.instructions,
          input: [{ role: 'user', content }],
          text: { format: { type: 'json_schema', name: spec.name, strict: true, schema: spec.schema } },
          store: false
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new AiUnavailableError('AI request failed', { cause: error });
    }
    if (!response.ok) {
      throw new AiUnavailableError(`AI HTTP ${response.status}`, { retryable: response.status === 429 || response.status >= 500 });
    }
    const payload = await response.json().catch(() => null);
    const text = extractOutputText(payload);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new AiUnavailableError('AI returned non-JSON output', { cause: error });
    }
  }

  return { configured, model, analyze };
}
