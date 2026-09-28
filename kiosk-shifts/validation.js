// Structured AI output contracts and the deterministic server-side acceptance
// decision. The model only reports what it sees; acceptance is decided here.
// Nothing in this file computes, compares or corrects money values.

export const REPORT_REQUIRED_FIELDS = Object.freeze([
  'cash_open',
  'cash_total',
  'transfer_total',
  'revenue_total',
  'cash_close'
]);

export const REPORT_OPTIONAL_FIELDS = Object.freeze([
  'employee',
  'date',
  'shift_start_written',
  'salary',
  'bar_expenses',
  'inspector_comment'
]);

// Sheet order, top to bottom.
export const REPORT_FIELDS = Object.freeze([
  'employee', 'date', 'shift_start_written',
  'cash_open', 'cash_total', 'transfer_total', 'revenue_total', 'cash_close',
  'salary', 'bar_expenses', 'inspector_comment'
]);

export const FIELD_LABELS = Object.freeze({
  employee: 'Сотрудник',
  date: 'Дата',
  shift_start_written: 'Начало смены',
  cash_open: 'НАЛИЧНЫХ В КАССЕ ПРИ ОТКРЫТИИ',
  cash_total: 'ИТОГО НАЛИЧНЫХ',
  transfer_total: 'ИТОГО ПЕРЕВОДОВ',
  revenue_total: 'ОБЩАЯ ВЫРУЧКА',
  cash_close: 'НАЛИЧНЫХ В КАССЕ ПРИ ЗАКРЫТИИ',
  salary: 'Зарплата',
  bar_expenses: 'Расходы на бар',
  inspector_comment: 'Комментарий проверяющего',
  signature: 'ПОДПИСЬ'
});

// Where each box is on the paper sheet, so the employee knows what to re-shoot.
const FIELD_AREA = Object.freeze({
  employee: 'top',
  date: 'top',
  shift_start_written: 'top',
  cash_open: 'top',
  cash_total: 'middle',
  transfer_total: 'middle',
  revenue_total: 'bottom',
  cash_close: 'bottom',
  salary: 'bottom',
  bar_expenses: 'bottom',
  inspector_comment: 'bottom',
  signature: 'bottom'
});

const AREA_TEXT = Object.freeze({
  top: 'верхнюю часть листа',
  middle: 'середину листа (итоги колонок)',
  bottom: 'нижнюю часть листа',
  whole: 'весь лист целиком'
});

const FIELD_STATUS = ['filled_legible', 'empty', 'illegible', 'not_visible'];
const CONFIDENCE = ['high', 'medium', 'low'];
const AREAS = ['top', 'middle', 'bottom', 'left', 'right'];

const fieldSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'status', 'confidence'],
  properties: {
    value: { type: 'string', description: 'Exactly what is handwritten, character by character. Empty string if empty or unreadable. Never guess.' },
    status: { type: 'string', enum: FIELD_STATUS },
    confidence: { type: 'string', enum: CONFIDENCE }
  }
};

const problemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' }
  }
};

export const REPORT_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'matches_template', 'quality', 'fields', 'signature', 'problems', 'accepted'],
  properties: {
    document_type: { type: 'string', enum: ['shift_report', 'other', 'unclear'] },
    matches_template: { type: 'boolean' },
    quality: {
      type: 'object',
      additionalProperties: false,
      required: ['sharp', 'glare_free', 'fully_visible', 'cropped_areas'],
      properties: {
        sharp: { type: 'boolean' },
        glare_free: { type: 'boolean' },
        fully_visible: { type: 'boolean' },
        cropped_areas: { type: 'array', items: { type: 'string', enum: AREAS } }
      }
    },
    fields: {
      type: 'object',
      additionalProperties: false,
      required: [...REPORT_FIELDS],
      properties: Object.fromEntries(REPORT_FIELDS.map((name) => [name, fieldSchema]))
    },
    signature: {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { type: 'string', enum: ['present', 'empty', 'not_visible'] } }
    },
    problems: { type: 'array', items: problemSchema },
    accepted: { type: 'boolean' }
  }
});

export const RECEIPT_JSON_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'receipt_present', 'quality', 'problems', 'accepted'],
  properties: {
    document_type: { type: 'string', enum: ['closing_receipt', 'other', 'unclear'] },
    receipt_present: { type: 'boolean' },
    quality: {
      type: 'object',
      additionalProperties: false,
      required: ['sharp', 'glare_free', 'fully_visible', 'small_digits_legible'],
      properties: {
        sharp: { type: 'boolean' },
        glare_free: { type: 'boolean' },
        fully_visible: { type: 'boolean' },
        small_digits_legible: { type: 'boolean' }
      }
    },
    problems: { type: 'array', items: problemSchema },
    accepted: { type: 'boolean' }
  }
});

// Minimal strict validator for the subset of JSON Schema used above. The model
// is asked for strict structured output, but the server never trusts that.
export function validateAgainstSchema(value, schema, path = '$') {
  const errors = [];
  const visit = (node, rule, at) => {
    if (rule.type === 'object') {
      if (!node || typeof node !== 'object' || Array.isArray(node)) { errors.push(`${at}: expected object`); return; }
      for (const key of rule.required || []) if (!(key in node)) errors.push(`${at}.${key}: missing`);
      if (rule.additionalProperties === false) {
        for (const key of Object.keys(node)) if (!rule.properties?.[key]) errors.push(`${at}.${key}: unexpected`);
      }
      for (const [key, child] of Object.entries(rule.properties || {})) if (key in node) visit(node[key], child, `${at}.${key}`);
    } else if (rule.type === 'array') {
      if (!Array.isArray(node)) { errors.push(`${at}: expected array`); return; }
      if (node.length > 50) errors.push(`${at}: too many items`);
      node.forEach((item, index) => visit(item, rule.items, `${at}[${index}]`));
    } else if (rule.type === 'string') {
      if (typeof node !== 'string') { errors.push(`${at}: expected string`); return; }
      if (node.length > 2000) errors.push(`${at}: too long`);
      if (rule.enum && !rule.enum.includes(node)) errors.push(`${at}: not allowed`);
    } else if (rule.type === 'boolean') {
      if (typeof node !== 'boolean') errors.push(`${at}: expected boolean`);
    }
  };
  visit(value, schema, path);
  return errors;
}

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

// A required money box counts as filled only if something digit-like is written
// and the model marked it as confidently legible. The value is kept verbatim.
function requiredFieldProblem(name, field) {
  const label = FIELD_LABELS[name];
  const area = AREA_TEXT[FIELD_AREA[name]];
  if (!field || field.status === 'not_visible') {
    return { code: 'field_not_visible', field: name, area: FIELD_AREA[name], message: `Не видно поле «${label}» — переснимите ${area}.` };
  }
  if (field.status === 'empty') {
    return { code: 'field_empty', field: name, area: FIELD_AREA[name], message: `Поле «${label}» пустое — заполните его и переснимите ${area}.` };
  }
  const value = cleanText(field.value, 60);
  if (field.status !== 'filled_legible' || field.confidence !== 'high' || !/\d/.test(value) || /[?]/.test(value)) {
    return { code: 'field_illegible', field: name, area: FIELD_AREA[name], message: `Не читается «${label}» — переснимите ${area} крупнее и без бликов.` };
  }
  return null;
}

export function decideReport(ai) {
  const errors = validateAgainstSchema(ai, REPORT_JSON_SCHEMA);
  if (errors.length) {
    const error = new Error('AI response does not match the report schema');
    error.schemaErrors = errors;
    throw error;
  }
  const problems = [];
  const isReport = ai.document_type === 'shift_report' && ai.matches_template;
  if (!isReport) {
    problems.push({ code: 'wrong_document', field: null, area: 'whole', message: 'Это не похоже на бланк «ТАБЕЛЬ СМЕНЫ». Сфотографируйте табель смены.' });
  }
  const qualityOk = Boolean(ai.quality.sharp && ai.quality.fully_visible);
  if (isReport && !ai.quality.sharp) {
    problems.push({ code: 'blurry', field: null, area: 'whole', message: 'Фото размыто — переснимите весь лист, держите телефон неподвижно.' });
  }
  if (isReport && !ai.quality.fully_visible) {
    const cropped = [...new Set(ai.quality.cropped_areas)];
    const where = cropped.includes('top') ? AREA_TEXT.top : cropped.includes('bottom') ? AREA_TEXT.bottom : AREA_TEXT.whole;
    problems.push({ code: 'cropped', field: null, area: cropped[0] || 'whole', message: `Лист обрезан — переснимите ${where}.` });
  }
  if (isReport) {
    for (const name of REPORT_REQUIRED_FIELDS) {
      const problem = requiredFieldProblem(name, ai.fields[name]);
      if (problem) problems.push(problem);
    }
    if (ai.signature.status !== 'present') {
      problems.push(ai.signature.status === 'empty'
        ? { code: 'signature_missing', field: 'signature', area: 'bottom', message: 'Нет подписи в поле «ПОДПИСЬ» — распишитесь и переснимите нижнюю часть листа.' }
        : { code: 'signature_not_visible', field: 'signature', area: 'bottom', message: 'Не видно поле «ПОДПИСЬ» — переснимите нижнюю часть листа.' });
    }
  }
  const requiredComplete = isReport && REPORT_REQUIRED_FIELDS.every((name) => !requiredFieldProblem(name, ai.fields[name]));
  const signaturePresent = ai.signature.status === 'present';
  if (!problems.length && !ai.accepted) {
    const hint = ai.problems.map((item) => cleanText(item.message, 200)).find(Boolean);
    problems.push({ code: 'model_rejected', field: null, area: 'whole', message: hint || 'Табель не удалось уверенно прочитать — переснимите весь лист.' });
  }
  const accepted = problems.length === 0;
  const fields = Object.fromEntries(REPORT_FIELDS.map((name) => {
    const field = ai.fields[name];
    const legible = field?.status === 'filled_legible' && field?.confidence === 'high';
    return [name, legible ? cleanText(field.value, name === 'inspector_comment' ? 300 : 60) : ''];
  }));
  return {
    document_type: 'shift_report',
    accepted,
    quality_ok: qualityOk,
    required_fields_complete: requiredComplete,
    fields,
    signature_present: signaturePresent,
    problems
  };
}

export function decideReceipt(ai) {
  const errors = validateAgainstSchema(ai, RECEIPT_JSON_SCHEMA);
  if (errors.length) {
    const error = new Error('AI response does not match the receipt schema');
    error.schemaErrors = errors;
    throw error;
  }
  const problems = [];
  const isReceipt = ai.document_type === 'closing_receipt' && ai.receipt_present;
  if (!isReceipt) problems.push({ code: 'receipt_missing', message: 'Чек не найден на фото. Сфотографируйте чек закрытия смены.' });
  if (isReceipt && !ai.quality.sharp) problems.push({ code: 'blurry', message: 'Фото чека размыто — переснимите, держите телефон неподвижно.' });
  if (isReceipt && !ai.quality.glare_free) problems.push({ code: 'glare', message: 'На чеке блик — переснимите под другим углом.' });
  if (isReceipt && !ai.quality.fully_visible) problems.push({ code: 'cropped', message: 'Чек обрезан — переснимите его целиком (можно частями, до 3 фото).' });
  if (isReceipt && !ai.quality.small_digits_legible) problems.push({ code: 'digits_illegible', message: 'Мелкие цифры чека не читаются — переснимите ближе.' });
  if (!problems.length && !ai.accepted) {
    const hint = ai.problems.map((item) => cleanText(item.message, 200)).find(Boolean);
    problems.push({ code: 'model_rejected', message: hint || 'Чек не удалось уверенно прочитать — переснимите.' });
  }
  const qualityOk = Boolean(ai.quality.sharp && ai.quality.glare_free && ai.quality.fully_visible && ai.quality.small_digits_legible);
  return { document_type: 'closing_receipt', accepted: problems.length === 0, quality_ok: qualityOk, problems };
}
