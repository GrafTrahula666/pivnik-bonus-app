import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';

import { barLocalParts, isLateStart } from '../kiosk-shifts/time.js';
import { decideReceipt, decideReport, REPORT_JSON_SCHEMA, RECEIPT_JSON_SCHEMA, REPORT_FIELDS, REPORT_REQUIRED_FIELDS } from '../kiosk-shifts/validation.js';
import { createKioskShiftService, suggestedPenaltyRub, normalizeEmployeeName } from '../kiosk-shifts/service.js';
import { createKioskShiftHttpHandler } from '../kiosk-shifts/http.js';
import { createTelegramNotifier } from '../kiosk-shifts/telegram.js';
import { createGoogleSheetsAdapter, shiftToSheetRow, SHEET_HEADER } from '../kiosk-shifts/sheets.js';
import { createOpenAiVisionClient, AiUnavailableError } from '../kiosk-shifts/ai.js';
import { kioskShiftConfigFromEnv } from '../kiosk-shifts/gateway.js';
import { applyKioskShiftsMigration } from '../scripts/apply-kiosk-shifts-migration.mjs';
import { isAutomaticStartupMigration } from '../migration-startup-policy.js';

const MIGRATION = new URL('../migrations/012_kiosk_shifts.sql', import.meta.url);
const ENROLL_CODE = 'TEST-ENROLL-CODE-123456';
// 2026-09-28 in Moscow (UTC+3).
const at = (hhmmss) => new Date(`2026-09-28T${hhmmss}+03:00`);
const jpeg = (seed = 'a', size = 4096) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.createHash('sha256').update(seed).digest(), Buffer.alloc(size, seed)]);

function pglitePool(db) {
  let chain = Promise.resolve();
  const lock = () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const previous = chain;
    chain = previous.then(() => held);
    return previous.then(() => release);
  };
  const run = async (sql, params) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  return {
    async query(sql, params) { const release = await lock(); try { return await run(sql, params); } finally { release(); } },
    async connect() { const release = await lock(); return { query: run, release }; }
  };
}

function field(value, status = 'filled_legible', confidence = 'high') {
  return { value, status, confidence };
}

function goodReport(overrides = {}) {
  return {
    document_type: 'shift_report',
    matches_template: true,
    quality: { sharp: true, glare_free: true, fully_visible: true, cropped_areas: [] },
    fields: {
      employee: field('Анна'),
      date: field('28.09.2026'),
      shift_start_written: field('10:40'),
      cash_open: field('5 000'),
      cash_total: field('12 350'),
      transfer_total: field('8 100'),
      revenue_total: field('99 999'), // deliberately not a sum: the system must not check arithmetic
      cash_close: field('17 350'),
      salary: field('3 000'),
      bar_expenses: field('', 'empty', 'high'),
      inspector_comment: field('', 'empty', 'high')
    },
    signature: { status: 'present' },
    problems: [],
    accepted: true,
    ...overrides
  };
}

function goodReceipt(overrides = {}) {
  return {
    document_type: 'closing_receipt',
    receipt_present: true,
    quality: { sharp: true, glare_free: true, fully_visible: true, small_digits_legible: true },
    problems: [],
    accepted: true,
    ...overrides
  };
}

function fakeAi(queue) {
  const calls = [];
  return {
    configured: true,
    model: 'test-vision',
    calls,
    async analyze(kind, images) {
      calls.push({ kind, count: images.length });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(kind, images);
      return next;
    }
  };
}

function recorder(configured = true) {
  const sent = [];
  return {
    configured,
    sent,
    async sendMessage(text) { if (!configured) { const { NotConfiguredError } = await import('../kiosk-shifts/telegram.js'); throw new NotConfiguredError('x'); } sent.push({ text }); },
    async sendPhotos(photos, caption) { sent.push({ photos: photos.length, caption }); },
    async upsertShiftRow(shift) { sent.push({ row: shiftToSheetRow(shift) }); }
  };
}

async function setup({ aiQueue = [], skipAiCheck = false, telegram = recorder(), sheets = recorder(), clock = () => at('12:00:00').getTime() } = {}) {
  const db = new PGlite();
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  const pool = pglitePool(db);
  const ai = fakeAi(aiQueue);
  const service = createKioskShiftService({
    pool, pepper: Buffer.from('pepper-for-tests'), enrollCode: ENROLL_CODE, ai, skipAiCheck, telegram, sheets, now: clock, log: { error() {} }
  });
  const { deviceToken } = await service.enrollDevice({ code: ENROLL_CODE, label: 'Пивник • Бар' });
  const device = await service.authenticate(deviceToken);
  return { db, pool, ai, service, device, deviceToken, telegram, sheets };
}

async function settle(service) {
  await service.kickOutbox();
  await service.drainOutbox({ limit: 50 });
}

async function outbox(pool) {
  return (await pool.query('SELECT * FROM kiosk_shift_outbox ORDER BY id')).rows;
}

// ---------------------------------------------------------------- time rules

test('late rule: 10:59:59 is on time, 11:00:00 and 11:01 are late (Europe/Moscow)', () => {
  assert.equal(isLateStart(at('10:59:59')), false);
  assert.equal(isLateStart(at('10:59:00')), false);
  assert.equal(isLateStart(at('11:00:00')), true);
  assert.equal(isLateStart(at('11:01:00')), true);
  assert.equal(isLateStart(new Date('2026-09-28T07:59:59Z')), false);
  assert.equal(isLateStart(new Date('2026-09-28T08:00:00Z')), true);
  assert.deepEqual(barLocalParts(at('10:42:10')), { date: '2026-09-28', displayDate: '28.09.2026', time: '10:42', secondsOfDay: 38530 });
});

test('employee name is free text but must be a real name', () => {
  assert.equal(normalizeEmployeeName('  Анна   Петрова '), 'Анна Петрова');
  assert.throws(() => normalizeEmployeeName('   '), /Введите имя/);
  assert.throws(() => normalizeEmployeeName('12345'), /буквы/);
  assert.throws(() => normalizeEmployeeName('А'.repeat(61)), /длинное/);
});

test('penalty ladder is only a suggestion for owner-confirmed violations', () => {
  assert.deepEqual([0, 1, 2, 3, 7].map(suggestedPenaltyRub), [0, 3000, 4000, 5000, 5000]);
});

// ---------------------------------------------------------------- AI decisions

test('report accepted: values are kept verbatim, arithmetic is never checked', () => {
  const decision = decideReport(goodReport());
  assert.equal(decision.accepted, true);
  assert.equal(decision.quality_ok, true);
  assert.equal(decision.required_fields_complete, true);
  assert.equal(decision.signature_present, true);
  assert.equal(decision.fields.revenue_total, '99 999');
  assert.equal(decision.fields.cash_total, '12 350');
  assert.equal(decision.fields.bar_expenses, '');
  assert.deepEqual(Object.keys(decision.fields), [...REPORT_FIELDS]);
  assert.deepEqual(decision.problems, []);
});

test('empty required box rejects the report with a concrete re-shoot hint', () => {
  const ai = goodReport();
  ai.fields.cash_total = field('', 'empty', 'high');
  const decision = decideReport(ai);
  assert.equal(decision.accepted, false);
  assert.equal(decision.required_fields_complete, false);
  const problem = decision.problems.find((item) => item.field === 'cash_total');
  assert.equal(problem.code, 'field_empty');
  assert.match(problem.message, /ИТОГО НАЛИЧНЫХ/);
  assert.match(problem.message, /середину листа/);
});

test('uncertain digits are never accepted even if the model says accepted', () => {
  for (const bad of [field('12 3?0'), field('12 350', 'filled_legible', 'medium'), field('12 350', 'illegible', 'low'), field('abc')]) {
    const ai = goodReport();
    ai.fields.cash_close = bad;
    const decision = decideReport(ai);
    assert.equal(decision.accepted, false, JSON.stringify(bad));
    assert.equal(decision.fields.cash_close === '12 350' && bad.confidence !== 'high', false);
    assert.match(decision.problems[0].message, /НАЛИЧНЫХ В КАССЕ ПРИ ЗАКРЫТИИ/);
  }
});

test('missing signature, blur, cropping and wrong document are rejected', () => {
  assert.match(decideReport(goodReport({ signature: { status: 'empty' } })).problems[0].message, /подписи/i);
  assert.match(decideReport(goodReport({ quality: { sharp: false, glare_free: true, fully_visible: true, cropped_areas: [] } })).problems[0].message, /размыто/);
  assert.match(decideReport(goodReport({ quality: { sharp: true, glare_free: true, fully_visible: false, cropped_areas: ['top'] } })).problems[0].message, /верхнюю часть/);
  const wrong = decideReport(goodReport({ document_type: 'other', matches_template: false }));
  assert.equal(wrong.accepted, false);
  assert.equal(wrong.problems[0].code, 'wrong_document');
  const modelNo = decideReport(goodReport({ accepted: false, problems: [{ code: 'x', message: 'Переснимите весь лист' }] }));
  assert.equal(modelNo.accepted, false);
  assert.equal(modelNo.problems[0].message, 'Переснимите весь лист');
});

test('each of the 6 mandatory boxes alone blocks acceptance', () => {
  assert.deepEqual([...REPORT_REQUIRED_FIELDS], ['cash_open', 'cash_total', 'transfer_total', 'revenue_total', 'cash_close']);
  const labels = {
    cash_open: 'НАЛИЧНЫХ В КАССЕ ПРИ ОТКРЫТИИ', cash_total: 'ИТОГО НАЛИЧНЫХ', transfer_total: 'ИТОГО ПЕРЕВОДОВ',
    revenue_total: 'ОБЩАЯ ВЫРУЧКА', cash_close: 'НАЛИЧНЫХ В КАССЕ ПРИ ЗАКРЫТИИ'
  };
  for (const name of REPORT_REQUIRED_FIELDS) {
    for (const bad of [field('', 'empty', 'high'), field('', 'not_visible', 'low'), field('12 3', 'illegible', 'low'), field('12 350', 'filled_legible', 'medium')]) {
      const ai = goodReport();
      ai.fields[name] = bad;
      const decision = decideReport(ai);
      assert.equal(decision.accepted, false, `${name} ${bad.status}/${bad.confidence}`);
      assert.equal(decision.required_fields_complete, false);
      assert.equal(decision.fields[name], '', 'uncertain value is never recorded');
      assert.equal(decision.problems.length, 1);
      assert.equal(decision.problems[0].field, name);
      assert.ok(decision.problems[0].message.includes(labels[name]));
    }
  }
  for (const status of ['empty', 'not_visible']) {
    const decision = decideReport(goodReport({ signature: { status } }));
    assert.equal(decision.accepted, false, `signature ${status}`);
    assert.equal(decision.signature_present, false);
    assert.equal(decision.problems[0].field, 'signature');
    assert.match(decision.problems[0].message, /ПОДПИСЬ/);
  }
  // Optional lines (salary, expenses, comment) never block.
  const optional = goodReport();
  for (const name of ['salary', 'bar_expenses', 'inspector_comment', 'employee', 'date', 'shift_start_written']) optional.fields[name] = field('', 'empty', 'high');
  assert.equal(decideReport(optional).accepted, true);
});

test('AI output that violates the strict schema is refused', () => {
  const extra = { ...goodReport(), guess: '1' };
  assert.throws(() => decideReport(extra), (error) => error.schemaErrors.some((item) => item.includes('unexpected')));
  const missing = goodReport();
  delete missing.fields.cash_open;
  assert.throws(() => decideReport(missing), /schema/);
  assert.throws(() => decideReport({ ...goodReport(), fields: { ...goodReport().fields, cash_open: field(5000) } }), /schema/);
  assert.equal(REPORT_JSON_SCHEMA.additionalProperties, false);
  assert.deepEqual(REPORT_JSON_SCHEMA.properties.fields.required, [...REPORT_FIELDS]);
});

test('receipt decision checks presence and legibility only', () => {
  assert.equal(decideReceipt(goodReceipt()).accepted, true);
  assert.match(decideReceipt(goodReceipt({ document_type: 'other', receipt_present: false })).problems[0].message, /Чек не найден/);
  assert.match(decideReceipt(goodReceipt({ quality: { sharp: true, glare_free: false, fully_visible: true, small_digits_legible: true } })).problems[0].message, /блик/);
  assert.match(decideReceipt(goodReceipt({ quality: { sharp: true, glare_free: true, fully_visible: true, small_digits_legible: false } })).problems[0].message, /Мелкие цифры/);
  assert.equal(RECEIPT_JSON_SCHEMA.additionalProperties, false);
});

test('OpenAI client sends images with a strict json_schema and parses output_text', async () => {
  const requests = [];
  const client = createOpenAiVisionClient({
    apiKey: 'sk-test', model: 'vision-test',
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(goodReceipt()) }] }] }), { status: 200 });
    }
  });
  const result = await client.analyze('receipt', [{ data: jpeg('r'), contentType: 'image/jpeg' }, { data: jpeg('s'), contentType: 'image/jpeg' }]);
  assert.equal(result.accepted, true);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].init.headers.authorization, 'Bearer sk-test');
  assert.equal(requests[0].body.text.format.type, 'json_schema');
  assert.equal(requests[0].body.text.format.strict, true);
  assert.equal(requests[0].body.input[0].content.filter((part) => part.type === 'input_image').length, 2);
  assert.match(requests[0].body.input[0].content[1].image_url, /^data:image\/jpeg;base64,/);

  const unconfigured = createOpenAiVisionClient({ apiKey: '', model: 'x', fetchImpl: async () => { throw new Error('must not call'); } });
  await assert.rejects(unconfigured.analyze('report', []), AiUnavailableError);
  const failing = createOpenAiVisionClient({ apiKey: 'k', model: 'x', fetchImpl: async () => new Response('{}', { status: 503 }) });
  await assert.rejects(failing.analyze('report', []), (error) => error instanceof AiUnavailableError && error.retryable);
});

// ---------------------------------------------------------------- service flow

test('enrollment requires the server-side code and returns an opaque device token', async () => {
  const { service } = await setup();
  await assert.rejects(service.enrollDevice({ code: 'wrong-code-000000' }), (error) => error.statusCode === 403);
  const noCode = createKioskShiftService({ pool: { query() {}, connect() {} }, pepper: 'p', enrollCode: '' });
  await assert.rejects(noCode.enrollDevice({ code: 'anything' }), (error) => error.statusCode === 503);
  assert.equal(await service.authenticate('pvkshift_forged-token-value-that-is-long-enough'), null);
});

test('shift start is idempotent, stores Moscow time and notifies owners once', async () => {
  const { service, device, pool } = await setup();
  const shiftId = crypto.randomUUID();
  const first = await service.startShift(device, { shiftId, employeeName: 'Анна', openedAt: at('10:42:00').toISOString() });
  assert.equal(first.created, true);
  assert.equal(first.shift.openedLocalTime, '10:42');
  assert.equal(first.shift.late, false);
  assert.equal(first.shift.reportStatus, 'missing');
  const retry = await service.startShift(device, { shiftId, employeeName: 'Анна', openedAt: at('10:42:00').toISOString() });
  assert.equal(retry.created, false);
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM kiosk_shifts');
  assert.equal(count.rows[0].n, 1);
  const items = await outbox(pool);
  assert.equal(items.length, 1);
  assert.equal(items[0].payload.text, 'Анна открыл(а) смену — 10:42');
});

test('shift opened at exactly 11:00 is late and says so in the notification', async () => {
  const { service, device, pool } = await setup();
  const result = await service.startShift(device, { shiftId: crypto.randomUUID(), employeeName: 'Олег', openedAt: at('11:00:00').toISOString() });
  assert.equal(result.shift.late, true);
  assert.equal((await outbox(pool))[0].payload.text, 'Олег открыл(а) смену — 11:00\nОПОЗДАНИЕ');
  const events = await pool.query("SELECT type FROM kiosk_shift_events WHERE type = 'late_start'");
  assert.equal(events.rowCount, 1);
});

test('shift start rejects bad input and impossible device clocks', async () => {
  const { service, device } = await setup();
  await assert.rejects(service.startShift(device, { shiftId: 'x', employeeName: 'Анна', openedAt: at('10:00:00').toISOString() }), /идентификатор/);
  await assert.rejects(service.startShift(device, { shiftId: crypto.randomUUID(), employeeName: '', openedAt: at('10:00:00').toISOString() }), /Введите имя/);
  await assert.rejects(service.startShift(device, { shiftId: crypto.randomUUID(), employeeName: 'Анна', openedAt: '2030-01-01T00:00:00Z' }), /время/i);
});

test('previous unclosed shift is kept, recorded as an incident and reported to owners', async () => {
  const { service, device, pool } = await setup();
  const oldId = crypto.randomUUID();
  await service.startShift(device, { shiftId: oldId, employeeName: 'Анна', openedAt: at('10:30:00').toISOString() });
  const next = await service.startShift(device, { shiftId: crypto.randomUUID(), employeeName: 'Олег', openedAt: at('11:30:00').toISOString() });
  assert.equal(next.previousUnclosed.length, 1);
  assert.equal(next.previousUnclosed[0].shiftId, oldId);
  const old = await pool.query('SELECT * FROM kiosk_shifts WHERE public_id = $1', [oldId]);
  assert.equal(old.rows[0].status, 'left_unclosed');
  assert.equal(old.rows[0].employee_name, 'Анна');
  const incidents = await pool.query('SELECT * FROM kiosk_shift_incidents');
  assert.equal(incidents.rowCount, 1);
  assert.equal(incidents.rows[0].owner_decision, null, 'no automatic violation or fine');
  const text = (await outbox(pool)).find((item) => item.dedupe_key.startsWith('prev-unclosed:')).payload.text;
  assert.match(text, /^Предыдущая смена не была закрыта\./);
  assert.match(text, /Решение о нарушении принимает владелец/);

  // A phone that lost track of an unsynced previous shift still reports it.
  const hintedId = crypto.randomUUID();
  const third = await service.startShift(device, {
    shiftId: crypto.randomUUID(), employeeName: 'Ира', openedAt: at('11:50:00').toISOString(),
    previousUnclosed: { shiftId: hintedId, employeeName: 'Вася', openedAt: at('09:00:00').toISOString() }
  });
  assert.ok(third.previousUnclosed.some((item) => item.shiftId === hintedId && item.employeeName === 'Вася'));
});

test('uploads validate type/size, are idempotent and bound to the device shift', async () => {
  const { service, device } = await setup();
  const shiftId = crypto.randomUUID();
  await service.startShift(device, { shiftId, employeeName: 'Анна', openedAt: at('10:00:00').toISOString() });
  const photoId = crypto.randomUUID();
  await assert.rejects(service.storePhoto(device, shiftId, 'report', photoId, Buffer.from('not an image'.repeat(200))), (error) => error.statusCode === 415);
  await assert.rejects(service.storePhoto(device, shiftId, 'report', photoId, jpeg('x', 10)), (error) => error.statusCode === 400);
  await assert.rejects(service.storePhoto(device, shiftId, 'report', '../../etc/passwd', jpeg()), (error) => error.statusCode === 400);
  await assert.rejects(service.storePhoto(device, shiftId, 'secret', photoId, jpeg()), (error) => error.statusCode === 404);
  assert.equal((await service.storePhoto(device, shiftId, 'report', photoId, jpeg('a'))).duplicate, false);
  assert.equal((await service.storePhoto(device, shiftId, 'report', photoId, jpeg('a'))).duplicate, true);
  await assert.rejects(service.storePhoto(device, shiftId, 'report', photoId, jpeg('b')), (error) => error.statusCode === 409);
  await assert.rejects(service.storePhoto(device, crypto.randomUUID(), 'report', crypto.randomUUID(), jpeg()), (error) => error.statusCode === 404);
});

async function openWithPhotos(env, count, kind = 'report') {
  const shiftId = crypto.randomUUID();
  await env.service.startShift(env.device, { shiftId, employeeName: 'Анна', openedAt: at('10:00:00').toISOString() });
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    await env.service.storePhoto(env.device, shiftId, kind, id, jpeg(`${kind}${index}`));
    ids.push(id);
  }
  return { shiftId, ids };
}

test('full happy path: 1-photo report, 3-photo receipt, close only after both accepted', async () => {
  const env = await setup({ aiQueue: [goodReport(), goodReceipt()] });
  const { service, device, pool } = env;
  const { shiftId, ids: reportIds } = await openWithPhotos(env, 1);
  await assert.rejects(service.closeShift(device, shiftId, {}), (error) => error.statusCode === 409 && error.code === 'documents_not_accepted');

  const report = await service.submitDocument(device, shiftId, 'report', reportIds);
  assert.equal(report.accepted, true);
  assert.equal(report.shift.reportStatus, 'accepted');
  assert.equal(report.shift.reportFields.cash_open, '5 000');
  await assert.rejects(service.closeShift(device, shiftId, {}), (error) => error.code === 'documents_not_accepted');

  const receiptIds = [];
  for (let index = 0; index < 3; index += 1) {
    const id = crypto.randomUUID();
    await service.storePhoto(device, shiftId, 'receipt', id, jpeg(`receipt${index}`));
    receiptIds.push(id);
  }
  const receipt = await service.submitDocument(device, shiftId, 'receipt', receiptIds);
  assert.equal(receipt.accepted, true);
  assert.deepEqual(env.ai.calls, [{ kind: 'report', count: 1 }, { kind: 'receipt', count: 3 }]);

  const again = await service.submitDocument(device, shiftId, 'report', reportIds);
  assert.equal(again.duplicate, true, 'accepted documents are not re-checked');
  assert.equal(env.ai.calls.length, 2);

  const closed = await service.closeShift(device, shiftId, { closedAt: at('23:15:00').toISOString() });
  assert.equal(closed.shift.status, 'closed');
  assert.equal(closed.shift.closedLocalTime, '12:00', 'future close time is replaced by server time');
  assert.equal((await service.closeShift(device, shiftId, {})).duplicate, true);

  const keys = (await outbox(pool)).map((item) => item.dedupe_key);
  assert.ok(keys.includes(`closed:${shiftId}`));
  assert.ok(keys.includes(`sheet:${shiftId}:documents`));
  assert.ok(keys.includes(`sheet:${shiftId}:closed`));

  await settle(service);
  const rows = env.sheets.sent.filter((item) => item.row);
  assert.equal(rows.at(-1).row[0], shiftId);
  assert.equal(rows.at(-1).row[4], 'нет');
  assert.equal(rows.at(-1).row[9], '99 999');
  assert.equal(rows.at(-1).row[13], 'принят');
  const texts = env.telegram.sent.map((item) => item.text).filter(Boolean);
  assert.ok(texts.some((text) => text.startsWith('Смена закрыта — Анна') && text.includes('Итого наличных: 12 350')));
  assert.ok(env.telegram.sent.some((item) => item.photos === 4), 'accepted report + receipt photos are forwarded');
});

test('more than 3 photos per check is refused; required-field failure keeps the shift open', async () => {
  const env = await setup({ aiQueue: [(() => { const r = goodReport(); r.fields.revenue_total = field('', 'empty', 'high'); return r; })()] });
  const { shiftId, ids } = await openWithPhotos(env, 4);
  await assert.rejects(env.service.submitDocument(env.device, shiftId, 'report', ids), /Не больше 3/);
  const result = await env.service.submitDocument(env.device, shiftId, 'report', ids.slice(0, 3));
  assert.equal(result.accepted, false);
  assert.equal(result.shift.reportStatus, 'rejected');
  assert.match(result.problems[0].message, /ОБЩАЯ ВЫРУЧКА/);
  await assert.rejects(env.service.closeShift(env.device, shiftId, {}), (error) => error.code === 'documents_not_accepted');
});

test('AI outage is retryable and never loses the uploaded photos', async () => {
  const env = await setup({ aiQueue: [new AiUnavailableError('down'), goodReport()] });
  const { shiftId, ids } = await openWithPhotos(env, 2);
  await assert.rejects(env.service.submitDocument(env.device, shiftId, 'report', ids), (error) => error.statusCode === 502 && error.retryable);
  const state = await env.service.getShift(env.device, shiftId);
  assert.equal(state.shift.reportStatus, 'missing');
  const retry = await env.service.submitDocument(env.device, shiftId, 'report', ids);
  assert.equal(retry.accepted, true);
});

test('unknown photo ids are reported so the phone re-uploads them', async () => {
  const env = await setup({ aiQueue: [goodReport()] });
  const { shiftId } = await openWithPhotos(env, 0);
  await assert.rejects(env.service.submitDocument(env.device, shiftId, 'report', [crypto.randomUUID()]), (error) => error.code === 'photos_missing');
});

test('missing AI key fails closed with a configuration error', async () => {
  const env = await setup();
  env.ai.configured = false;
  const { shiftId, ids } = await openWithPhotos(env, 1);
  await assert.rejects(env.service.submitDocument(env.device, shiftId, 'report', ids), (error) => error.statusCode === 503 && error.code === 'ai_not_configured');
});

test('with the AI check switched off documents are accepted and the shift closes', async () => {
  const env = await setup({ skipAiCheck: true });
  const { shiftId } = await openWithPhotos(env, 0);
  const reportId = crypto.randomUUID();
  await env.service.storePhoto(env.device, shiftId, 'report', reportId, jpeg('r'));
  const report = await env.service.submitDocument(env.device, shiftId, 'report', [reportId], { revenue_total: '45 300', cash_close: '=12 000', extra: 'x' });
  assert.equal(report.accepted, true);
  assert.deepEqual(report.shift.reportFields, { revenue_total: '45 300', cash_close: '12 000' });
  const receiptId = crypto.randomUUID();
  await env.service.storePhoto(env.device, shiftId, 'receipt', receiptId, jpeg('c'));
  assert.equal((await env.service.submitDocument(env.device, shiftId, 'receipt', [receiptId])).accepted, true);
  assert.equal(env.ai.calls.length, 0);
  const closed = await env.service.closeShift(env.device, shiftId, {});
  assert.equal(closed.shift.status, 'closed');
  await settle(env.service);
});

test('invoices never block closing and are forwarded as an album', async () => {
  const env = await setup({ aiQueue: [goodReport(), goodReceipt()] });
  const { shiftId, ids } = await openWithPhotos(env, 3, 'invoice');
  const sent = await env.service.submitDocument(env.device, shiftId, 'invoice', ids);
  assert.equal(sent.sent, 3);
  assert.equal((await env.service.submitDocument(env.device, shiftId, 'invoice', ids)).duplicate, true);
  assert.equal(env.ai.calls.length, 0, 'invoices are not AI-validated');
  const reportId = crypto.randomUUID();
  await env.service.storePhoto(env.device, shiftId, 'report', reportId, jpeg('r'));
  await env.service.submitDocument(env.device, shiftId, 'report', [reportId]);
  const receiptId = crypto.randomUUID();
  await env.service.storePhoto(env.device, shiftId, 'receipt', receiptId, jpeg('c'));
  await env.service.submitDocument(env.device, shiftId, 'receipt', [receiptId]);
  assert.equal((await env.service.closeShift(env.device, shiftId, {})).shift.status, 'closed');
  await settle(env.service);
  assert.ok(env.telegram.sent.some((item) => item.photos === 3 && /накладные/.test(item.caption)));
});

test('outbox keeps messages while Telegram credentials are missing', async () => {
  const env = await setup({ telegram: recorder(false) });
  await env.service.startShift(env.device, { shiftId: crypto.randomUUID(), employeeName: 'Анна', openedAt: at('10:00:00').toISOString() });
  await settle(env.service);
  const [item] = await outbox(env.pool);
  assert.equal(item.done_at, null);
  assert.equal(item.abandoned_at, null);
  assert.match(item.last_error, /not configured|x/);
});

// ---------------------------------------------------------------- adapters

test('Telegram adapter posts plain text and albums to the configured chat only', async () => {
  const calls = [];
  const notifier = createTelegramNotifier({
    botToken: '123:abc', chatId: '-100500',
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, result: {} })); }
  });
  await notifier.sendMessage('Анна открыл(а) смену — 10:42');
  await notifier.sendPhotos([{ data: jpeg('1'), contentType: 'image/jpeg' }, { data: jpeg('2'), contentType: 'image/jpeg' }], 'cap');
  assert.equal(calls[0].url, 'https://api.telegram.org/bot123:abc/sendMessage');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.chat_id, '-100500');
  assert.equal(body.parse_mode, undefined);
  assert.equal(calls[1].url, 'https://api.telegram.org/bot123:abc/sendMediaGroup');
  assert.ok(calls[1].init.body instanceof FormData);
  assert.equal(JSON.parse(calls[1].init.body.get('media')).length, 2);
  const off = createTelegramNotifier({ botToken: '', chatId: '' });
  assert.equal(off.configured, false);
  await assert.rejects(off.sendMessage('x'), /not configured/);
});

test('Google Sheets adapter signs a service-account JWT and upserts one row per shift', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = { client_email: 'bot@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const sheet = [];
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method });
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init.body)).get('assertion');
      const [header, claims] = assertion.split('.').slice(0, 2).map((part) => JSON.parse(Buffer.from(part, 'base64url').toString()));
      assert.equal(header.alg, 'RS256');
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    }
    assert.equal(init.headers.authorization, 'Bearer tok');
    const decoded = decodeURIComponent(url);
    if (init.method === 'GET') return new Response(JSON.stringify({ values: sheet.length ? [sheet.map((row) => row[0])] : [] }));
    const values = JSON.parse(init.body).values;
    assert.match(decoded, /valueInputOption=RAW/);
    if (decoded.includes(':append')) sheet.push(values[0]);
    else {
      const rowNumber = Number(decoded.match(/!A(\d+):/)[1]);
      sheet[rowNumber - 1] = values[0];
    }
    return new Response('{}');
  };
  const adapter = createGoogleSheetsAdapter({ serviceAccountJson: Buffer.from(JSON.stringify(account)).toString('base64'), spreadsheetId: 'sheet-id', fetchImpl });
  assert.equal(adapter.configured, true);
  const shift = {
    public_id: 's-1', opened_local_date_display: '28.09.2026', employee_name: '=HYPERLINK("x")', opened_local_time: '11:00', late: true,
    status: 'open', report_status: 'accepted', receipt_status: 'accepted', report_fields: { cash_open: '5 000', revenue_total: '99 999' }
  };
  await adapter.upsertShiftRow(shift);
  await adapter.upsertShiftRow({ ...shift, status: 'closed', closed_local_time: '23:15' });
  assert.deepEqual(sheet[0], [...SHEET_HEADER]);
  assert.equal(sheet.length, 2, 'one shift = one row');
  assert.equal(sheet[1][2], '=HYPERLINK("x")', 'written raw as text');
  assert.equal(sheet[1][4], 'да');
  assert.equal(sheet[1][5], '23:15');
  assert.equal(sheet[1][15], 'закрыта');
  assert.equal(calls.filter((call) => call.url.includes('oauth2')).length, 1, 'token cached');
  assert.equal(createGoogleSheetsAdapter({ serviceAccountJson: '', spreadsheetId: '' }).configured, false);
});

// ---------------------------------------------------------------- HTTP boundary

async function withServer(handler, work) {
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://local')));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await work(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('HTTP: disabled switch, auth, enrollment, traversal and body limits', async () => {
  const env = await setup();
  const rate = new Map();
  const enforceRateLimit = (key, limit) => {
    const count = (rate.get(key) || 0) + 1;
    rate.set(key, count);
    if (count > limit) throw Object.assign(new Error('rate'), { statusCode: 429 });
  };
  const disabled = createKioskShiftHttpHandler({ service: env.service, enabled: false, enforceRateLimit, requestAddress: () => 'ip' });
  await withServer(disabled, async (base) => {
    assert.equal((await fetch(`${base}/api/kiosk/v1/status`)).status, 404);
  });
  const handler = createKioskShiftHttpHandler({ service: env.service, enabled: true, enforceRateLimit, requestAddress: () => 'ip' });
  await withServer(handler, async (base) => {
    assert.equal((await fetch(`${base}/api/kiosk/v1/status`)).status, 401);
    assert.equal((await fetch(`${base}/api/kiosk/v1/status`, { headers: { authorization: 'Bearer abc' } })).status, 401);
    const enrolled = await fetch(`${base}/api/kiosk/v1/enroll`, { method: 'POST', body: JSON.stringify({ code: ENROLL_CODE, label: 'Бар' }) });
    assert.equal(enrolled.status, 201);
    const { deviceToken } = await enrolled.json();
    assert.match(deviceToken, /^pvkshift_/);
    const auth = { authorization: `KioskShift ${deviceToken}` };
    const status = await (await fetch(`${base}/api/kiosk/v1/status`, { headers: auth })).json();
    assert.deepEqual(Object.keys(status.configuration).sort(), ['ai', 'enrollment', 'sheets', 'telegram']);
    assert.equal(JSON.stringify(status).includes(ENROLL_CODE), false);

    const shiftId = crypto.randomUUID();
    const started = await fetch(`${base}/api/kiosk/v1/shifts`, { method: 'POST', headers: auth, body: JSON.stringify({ shiftId, employeeName: 'Анна', openedAt: at('10:00:00').toISOString() }) });
    assert.equal(started.status, 200);
    assert.equal((await fetch(`${base}/api/kiosk/v1/shifts/..%2F..%2Fetc`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/api/kiosk/v1/shifts/${shiftId}/documents/report/photos/${crypto.randomUUID()}`, {
      method: 'PUT', headers: { ...auth, 'content-type': 'image/jpeg', 'content-length': String(9 * 1024 * 1024) }, body: Buffer.alloc(16)
    }).catch(() => ({ status: 413 }))).status, 413);
    const upload = await fetch(`${base}/api/kiosk/v1/shifts/${shiftId}/documents/report/photos/${crypto.randomUUID()}`, { method: 'PUT', headers: { ...auth, 'content-type': 'image/jpeg' }, body: jpeg('h') });
    assert.equal(upload.status, 201);
    const closeEarly = await fetch(`${base}/api/kiosk/v1/shifts/${shiftId}/close`, { method: 'POST', headers: auth, body: '{}' });
    assert.equal(closeEarly.status, 409);
    assert.equal((await closeEarly.json()).code, 'documents_not_accepted');
    const bad = await fetch(`${base}/api/kiosk/v1/shifts`, { method: 'POST', headers: auth, body: '{bad json' });
    assert.equal(bad.status, 400);
  });
});

// ---------------------------------------------------------------- migration policy

test('migration 012 is additive, gated and applied only by the operator script', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');
  assert.equal(isAutomaticStartupMigration('012_kiosk_shifts.sql'), false);
  assert.doesNotMatch(sql, /\b(DROP|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+(?!kiosk_))\b/i);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT\s+INTO)\s+(users|wallets|transactions)\b/i);
  for (const table of sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/g)) assert.match(table, /kiosk_shift/);

  const db = new PGlite();
  const client = pglitePool(db);
  const first = await applyKioskShiftsMigration({ query: (text, params) => (params ? client.query(text, params) : db.exec(text).then(() => ({ rows: [], rowCount: 0 }))) }, sql);
  assert.equal(first.applied, true);
  const second = await applyKioskShiftsMigration({ query: (text, params) => (params ? client.query(text, params) : db.exec(text).then(() => ({ rows: [], rowCount: 0 }))) }, sql);
  assert.equal(second.applied, false);
});

test('configuration reads secrets from the server environment only', () => {
  const config = kioskShiftConfigFromEnv({ PIVNIK_KIOSK_SHIFTS: 'true', TELEGRAM_BOT_TOKEN: 'main-bot', KIOSK_SHIFT_TELEGRAM_CHAT_ID: '-1' });
  assert.equal(config.enabled, true);
  assert.equal(config.telegramBotToken, 'main-bot');
  assert.equal(config.googleSheetName, 'Смены');
  assert.equal(kioskShiftConfigFromEnv({}).enabled, false);
});
