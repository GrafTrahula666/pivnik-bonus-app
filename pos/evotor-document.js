// REST v2: https://developer.evotor.ru/docs/rest_api_scheme_documents.html
// Never infer a Pivnik identity from customer_phone, name, time or amount.
export function scaledInteger(value, digits = 2) {
  const text = String(value ?? '');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] || '').length > digits) throw new Error('Некорректная сумма или количество Эвотора.');
  const result = BigInt(match[1]) * 10n ** BigInt(digits)
    + BigInt((match[2] || '').padEnd(digits, '0'));
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Превышен безопасный диапазон суммы.');
  return Number(result);
}

function identifier(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Нет идентификатора документа Эвотора.');
  return value;
}

function unpack(value, key) { return value?.[key] || value; }

// REST returns the requesting application's own context in TOP-LEVEL extras:
// https://developer.evotor.ru/docs/rest_api_get_store_documents.html
// Read only our versioned marker; never retain arbitrary extras/contact data.
function redemptionEvidence(document) {
  const marker = document.extras?.pivnikLoyaltyV1;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || marker.version !== 1
      || typeof marker.operationId !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(marker.operationId)
      || !Number.isSafeInteger(marker.points) || marker.points < 1 || marker.points > 90071992547409) return null;
  let discount = null;
  try {
    const discounts = document.body.doc_discounts;
    if (Array.isArray(discounts) && discounts.length <= 1000) {
      discount = discounts.reduce((sum, value) => sum + scaledInteger(unpack(value, 'doc_discount').discount_sum), 0);
      if (!Number.isSafeInteger(discount)) discount = null;
    }
  } catch { discount = null; }
  return { operationId: marker.operationId, points: marker.points, documentDiscountCents: discount };
}

export function normalizeEvotorDocument(document, storeId) {
  if (!['SELL', 'PAYBACK'].includes(document?.type)) return null;
  if (document.store_id !== storeId) throw new Error('Документ другого магазина.');
  const date = new Date(document.close_date);
  if (!document.close_date || !Number.isFinite(date.getTime())) throw new Error('Нет даты закрытия документа.');
  const body = document.body;
  if (!body || !Array.isArray(body.positions) || !Array.isArray(body.payments)) throw new Error('Неполный документ Эвотора.');
  const amountCents = scaledInteger(body.result_sum);
  const positions = body.positions.map((position) => ({
    productId: position.product_id || null,
    name: String(position.product_name || 'Свободная позиция').slice(0, 500),
    measure: String(position.measure_name || '').slice(0, 80),
    quantityMillis: scaledInteger(position.quantity, 3),
    amountCents: scaledInteger(position.result_sum)
  }));
  const payments = body.payments.map((entry) => {
    const payment = unpack(entry, 'payment');
    return {
      type: String(payment.type || 'UNKNOWN').slice(0, 80),
      method: String(payment.cashless_info?.method || '').slice(0, 80),
      amountCents: scaledInteger(payment.sum)
    };
  });
  const prints = (body.pos_print_results || []).map((entry) => unpack(entry, 'pos_print_result'));
  const groups = (body.print_groups || []).map((entry) => unpack(entry, 'print_group'));
  // Fiscal details may be missing in old/non-fiscal documents: never invent a receipt count.
  const receiptCount = prints.length || null;
  const redemption = redemptionEvidence(document);
  return {
    source: 'evotor', storeId: identifier(storeId), documentId: identifier(document.id),
    type: document.type, closedAt: date.toISOString(),
    number: String(document.number ?? ''), deviceId: String(document.device_id || ''),
    baseDocumentId: body.base_document_id || null, amountCents, positions, payments,
    receiptCount, linkable: prints.length === 1 && groups.length <= 1,
    // Legacy documents retain their byte-compatible snapshot. Only our narrowly
    // parsed own-app marker is included for a redemption document.
    ...(redemption ? { pivnikRedemption: redemption } : {}),
    // Minimal financial snapshot. No contact data, token or arbitrary raw payload.
    fiscal: prints.map((p) => ({
      number: p.fiscal_document_number ?? p.document_number ?? null,
      receiptNumber: p.receipt_number ?? null,
      fn: p.fn_serial_number || null
    }))
  };
}

export function moscowPeriod({ period = 'today', from, to } = {}, now = new Date()) {
  const today = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const day = (date, delta) => new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400_000).toISOString().slice(0, 10);
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '')
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  let start = today, end = today;
  if (period === 'yesterday') start = end = day(today, -1);
  else if (period === '7days') start = day(today, -6);
  else if (period === 'month') start = today.slice(0, 8) + '01';
  else if (period === 'custom') {
    if (!valid(from) || !valid(to) || from > to) throw Object.assign(new Error('Проверьте даты периода.'), { statusCode: 400 });
    start = from; end = to;
    if (Date.parse(to) - Date.parse(from) >= 366 * 86400_000) throw Object.assign(new Error('Максимальный период — 366 дней.'), { statusCode: 400 });
  } else if (period !== 'today') throw Object.assign(new Error('Неизвестный период.'), { statusCode: 400 });
  return { from: `${start}T00:00:00+03:00`, until: `${day(end, 1)}T00:00:00+03:00`, start, end, timeZone: 'Europe/Moscow' };
}
