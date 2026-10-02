import crypto from 'node:crypto';
import { barLocalParts, isLateStart } from './time.js';
import { decideReceipt, decideReport } from './validation.js';
import { AiUnavailableError } from './ai.js';
import { NotConfiguredError } from './telegram.js';
import {
  documentTroubleText,
  invoicesCaption,
  previousShiftUnclosedText,
  shiftClosedText,
  shiftOpenedText
} from './messages.js';

export const DEVICE_TOKEN_PREFIX = 'pvkshift_';
export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const DOCUMENT_KINDS = Object.freeze(['report', 'receipt', 'invoice']);
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const MIN_PHOTO_BYTES = 1024;
const MAX_PHOTOS_PER_CHECK = 3;
const MAX_INVOICES_PER_SUBMIT = 10;
const MAX_UPLOADS = Object.freeze({ report: 30, receipt: 30, invoice: 60 });
const PENDING_LOCK_MS = 3 * 60 * 1000;
const MAX_OPENED_AT_FUTURE_MS = 5 * 60 * 1000;
const MAX_OPENED_AT_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const OUTBOX_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const TROUBLE_NOTIFY_AFTER = 3;

// Suggested amount for the owner's n-th CONFIRMED violation. Informational only:
// nothing in the system deducts money or confirms a violation by itself.
export function suggestedPenaltyRub(confirmedViolationNumber) {
  const n = Number(confirmedViolationNumber);
  if (!Number.isInteger(n) || n < 1) return 0;
  return n === 1 ? 3000 : n === 2 ? 4000 : 5000;
}

export function httpError(statusCode, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

export function normalizeEmployeeName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) throw httpError(400, 'Введите имя.');
  if (name.length > 60) throw httpError(400, 'Имя слишком длинное (до 60 символов).');
  if (!/\p{L}/u.test(name)) throw httpError(400, 'Имя должно содержать буквы.');
  return name;
}

export function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function publicShift(row) {
  if (!row) return null;
  return {
    id: row.public_id,
    employeeName: row.employee_name,
    openedAt: new Date(row.opened_at).toISOString(),
    openedLocalDate: barLocalParts(row.opened_at).date,
    openedLocalTime: row.opened_local_time,
    late: Boolean(row.late),
    status: row.status,
    reportStatus: row.report_status,
    receiptStatus: row.receipt_status,
    reportFields: row.report_status === 'accepted' ? row.report_fields : null,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    closedLocalTime: row.closed_local_time || null
  };
}

function withDisplayDate(row) {
  return row ? { ...row, opened_local_date_display: barLocalParts(row.opened_at).displayDate } : row;
}

// Values typed by the employee when the AI check is off; only two known fields, short text, no formulas.
function manualReportFields(manual) {
  const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f=+@]/g, '').trim().slice(0, 40);
  const result = {};
  const revenue = clean(manual?.revenue_total);
  const cash = clean(manual?.cash_close);
  if (revenue) result.revenue_total = revenue;
  if (cash) result.cash_close = cash;
  return result;
}

export function createKioskShiftService({
  pool,
  pepper,
  enrollCode = '',
  maxDevices = 3,
  ai,
  skipAiCheck = false,
  telegram,
  sheets,
  now = () => Date.now(),
  log = console
}) {
  if (!pool?.query || !pool?.connect) throw new Error('kiosk shifts pool is required');
  if (!pepper) throw new Error('kiosk shifts pepper is required');
  const digest = (value) => crypto.createHmac('sha256', pepper).update(String(value)).digest('hex');
  let schemaReadyCache = false;
  let schemaCheckedAt = 0;
  let draining = null;

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function schemaReady() {
    if (schemaReadyCache) return true;
    if (now() - schemaCheckedAt < 30_000 && schemaCheckedAt) return false;
    schemaCheckedAt = now();
    const result = await pool.query("SELECT to_regclass('kiosk_shift_outbox') IS NOT NULL AS ok");
    schemaReadyCache = Boolean(result.rows[0]?.ok);
    return schemaReadyCache;
  }

  async function enqueue(db, channel, dedupeKey, payload) {
    await db.query(
      `INSERT INTO kiosk_shift_outbox (dedupe_key, channel, payload) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [dedupeKey, channel, JSON.stringify(payload)]
    );
  }

  async function recordEvent(db, { shiftId = null, deviceId = null, type, details = {} }) {
    await db.query(
      'INSERT INTO kiosk_shift_events (shift_id, device_id, type, details) VALUES ($1, $2, $3, $4::jsonb)',
      [shiftId, deviceId, type, JSON.stringify(details)]
    );
  }

  // ---------- devices ----------

  async function enrollDevice({ code, label }) {
    const expected = String(enrollCode || '');
    if (expected.length < 12) throw httpError(503, 'Подключение смен не настроено на сервере.');
    const given = crypto.createHash('sha256').update(String(code || '').trim()).digest();
    const wanted = crypto.createHash('sha256').update(expected).digest();
    if (!crypto.timingSafeEqual(given, wanted)) throw httpError(403, 'Неверный код подключения.');
    const deviceLabel = String(label || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 80) || 'Пивник • Бар';
    return transaction(async (db) => {
      await db.query("SELECT pg_advisory_xact_lock(hashtext('pivnik-kiosk-shift-enroll'))");
      const active = await db.query('SELECT COUNT(*)::int AS n FROM kiosk_shift_devices WHERE revoked_at IS NULL');
      const overflow = Number(active.rows[0].n) - maxDevices + 1;
      if (overflow > 0) {
        // Re-installing the app creates a new device record each time; retire the least recently seen ones instead of blocking the phone.
        await db.query(
          `UPDATE kiosk_shift_devices SET revoked_at = NOW()
           WHERE id IN (SELECT id FROM kiosk_shift_devices WHERE revoked_at IS NULL ORDER BY last_seen_at ASC NULLS FIRST, id ASC LIMIT $1)`,
          [overflow]
        );
      }
      const token = `${DEVICE_TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
      const publicId = crypto.randomUUID();
      await db.query(
        'INSERT INTO kiosk_shift_devices (public_id, label, token_hash, last_seen_at) VALUES ($1, $2, $3, NOW())',
        [publicId, deviceLabel, digest(token)]
      );
      await recordEvent(db, { type: 'device_enrolled', details: { publicId, label: deviceLabel } });
      return { deviceToken: token, device: { id: publicId, label: deviceLabel } };
    });
  }

  async function authenticate(token) {
    const raw = String(token || '');
    if (!raw.startsWith(DEVICE_TOKEN_PREFIX) || raw.length < 40 || raw.length > 120) return null;
    const result = await pool.query(
      `UPDATE kiosk_shift_devices SET last_seen_at = NOW()
       WHERE token_hash = $1 AND revoked_at IS NULL
       RETURNING id, public_id, label`,
      [digest(raw)]
    );
    return result.rows[0] || null;
  }

  // ---------- shifts ----------

  async function lockShift(db, device, shiftPublicId) {
    if (!ID_PATTERN.test(String(shiftPublicId || ''))) throw httpError(400, 'Неверный идентификатор смены.');
    const result = await db.query('SELECT * FROM kiosk_shifts WHERE public_id = $1 FOR UPDATE', [shiftPublicId]);
    const shift = result.rows[0];
    if (!shift) throw httpError(404, 'Смена не найдена.');
    // Re-enrolling the same phone makes a new device record: the open shift follows the phone.
    if (String(shift.device_id) !== String(device.id)) {
      const adopted = await db.query('UPDATE kiosk_shifts SET device_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *', [shift.id, device.id]);
      return adopted.rows[0];
    }
    return shift;
  }

  async function startShift(device, body = {}) {
    const shiftPublicId = String(body.shiftId || '').toLowerCase();
    if (!ID_PATTERN.test(shiftPublicId)) throw httpError(400, 'Неверный идентификатор смены.');
    const employeeName = normalizeEmployeeName(body.employeeName);
    const openedAt = new Date(String(body.openedAt || ''));
    if (Number.isNaN(openedAt.getTime())) throw httpError(400, 'Неверное время открытия смены.');
    const current = now();
    if (openedAt.getTime() > current + MAX_OPENED_AT_FUTURE_MS || openedAt.getTime() < current - MAX_OPENED_AT_PAST_MS) {
      throw httpError(400, 'Время на телефоне не совпадает с реальным. Проверьте дату и время.');
    }
    const local = barLocalParts(openedAt);
    const late = isLateStart(openedAt);
    const hinted = body.previousUnclosed && typeof body.previousUnclosed === 'object' ? body.previousUnclosed : null;

    const outcome = await transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pivnik-kiosk-shift-device:${device.id}`]);
      const existing = await db.query('SELECT * FROM kiosk_shifts WHERE public_id = $1', [shiftPublicId]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (String(row.device_id) !== String(device.id)) {
          await db.query('UPDATE kiosk_shifts SET device_id = $2, updated_at = NOW() WHERE id = $1', [row.id, device.id]);
          row.device_id = device.id;
        }
        const incidents = await db.query(
          `SELECT previous_shift_public_id, previous_employee_name, previous_opened_at
           FROM kiosk_shift_incidents WHERE new_shift_id = $1 ORDER BY id`,
          [row.id]
        );
        return { row, created: false, previous: incidents.rows };
      }

      const inserted = await db.query(
        `INSERT INTO kiosk_shifts (public_id, device_id, employee_name, opened_at, opened_local_date, opened_local_time, late)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7) RETURNING *`,
        [shiftPublicId, device.id, employeeName, openedAt.toISOString(), local.date, local.time, late]
      );
      const row = inserted.rows[0];
      await recordEvent(db, { shiftId: row.id, deviceId: device.id, type: 'shift_opened', details: { employeeName, late, openedLocalTime: local.time } });
      if (late) await recordEvent(db, { shiftId: row.id, deviceId: device.id, type: 'late_start', details: { openedLocalTime: local.time } });
      await enqueue(db, 'telegram', `opened:${row.public_id}`, { type: 'text', text: shiftOpenedText(row) });

      // Never delete or overwrite the previous shift: it is only marked as left
      // unclosed, and the owners are told. The owner decides about violations.
      const previousOpen = await db.query(
        `SELECT * FROM kiosk_shifts WHERE device_id = $1 AND status = 'open' AND id <> $2 ORDER BY opened_at FOR UPDATE`,
        [device.id, row.id]
      );
      const previous = [];
      for (const prev of previousOpen.rows) {
        await db.query(
          "UPDATE kiosk_shifts SET status = 'left_unclosed', left_unclosed_at = NOW(), updated_at = NOW() WHERE id = $1",
          [prev.id]
        );
        previous.push({ previous_shift_public_id: prev.public_id, previous_employee_name: prev.employee_name, previous_opened_at: prev.opened_at });
        await enqueue(db, 'sheets', `sheet:${prev.public_id}:left_unclosed`, { shiftPublicId: prev.public_id });
      }
      if (hinted && ID_PATTERN.test(String(hinted.shiftId || '').toLowerCase())
        && !previous.some((item) => item.previous_shift_public_id === String(hinted.shiftId).toLowerCase())) {
        const known = await db.query('SELECT status FROM kiosk_shifts WHERE public_id = $1', [String(hinted.shiftId).toLowerCase()]);
        const hintedOpenedAt = new Date(String(hinted.openedAt || ''));
        if (!known.rowCount) {
          previous.push({
            previous_shift_public_id: String(hinted.shiftId).toLowerCase(),
            previous_employee_name: hinted.employeeName ? normalizeEmployeeName(hinted.employeeName) : null,
            previous_opened_at: Number.isNaN(hintedOpenedAt.getTime()) ? null : hintedOpenedAt.toISOString()
          });
        }
      }
      for (const item of previous) {
        const incident = await db.query(
          `INSERT INTO kiosk_shift_incidents (type, previous_shift_public_id, previous_employee_name, previous_opened_at, new_shift_id)
           VALUES ('previous_shift_unclosed', $1, $2, $3, $4)
           ON CONFLICT (type, previous_shift_public_id) DO NOTHING RETURNING id`,
          [item.previous_shift_public_id, item.previous_employee_name, item.previous_opened_at, row.id]
        );
        if (!incident.rowCount) continue;
        await recordEvent(db, { shiftId: row.id, deviceId: device.id, type: 'previous_shift_unclosed', details: item });
        await enqueue(db, 'telegram', `prev-unclosed:${item.previous_shift_public_id}`, {
          type: 'text',
          text: previousShiftUnclosedText({
            previousEmployeeName: item.previous_employee_name,
            previousOpenedAt: item.previous_opened_at,
            newShift: row
          })
        });
      }
      return { row, created: true, previous };
    });
    kickOutbox();
    return {
      created: outcome.created,
      shift: publicShift(outcome.row),
      previousUnclosed: outcome.previous.map((item) => ({
        shiftId: item.previous_shift_public_id,
        employeeName: item.previous_employee_name,
        openedAt: item.previous_opened_at ? new Date(item.previous_opened_at).toISOString() : null
      }))
    };
  }

  async function getShift(device, shiftPublicId) {
    if (!ID_PATTERN.test(String(shiftPublicId || ''))) throw httpError(400, 'Неверный идентификатор смены.');
    const result = await pool.query('SELECT * FROM kiosk_shifts WHERE public_id = $1', [shiftPublicId]);
    if (!result.rowCount) throw httpError(404, 'Смена не найдена.');
    return { shift: publicShift(result.rows[0]) };
  }

  async function listShifts(device, limit = 20) {
    const size = Math.max(1, Math.min(100, Number(limit) || 20));
    const result = await pool.query(
      'SELECT * FROM kiosk_shifts WHERE device_id = $1 ORDER BY opened_at DESC LIMIT $2',
      [device.id, size]
    );
    return { shifts: result.rows.map(publicShift) };
  }

  // ---------- photos & documents ----------

  async function storePhoto(device, shiftPublicId, kind, photoPublicId, data) {
    if (!DOCUMENT_KINDS.includes(kind)) throw httpError(404, 'Неизвестный тип документа.');
    const photoId = String(photoPublicId || '').toLowerCase();
    if (!ID_PATTERN.test(photoId)) throw httpError(400, 'Неверный идентификатор фото.');
    if (!Buffer.isBuffer(data) || data.length < MIN_PHOTO_BYTES) throw httpError(400, 'Фото пустое или повреждено.');
    if (data.length > MAX_PHOTO_BYTES) throw httpError(413, 'Фото слишком большое.');
    const contentType = detectImageType(data);
    if (!contentType) throw httpError(415, 'Поддерживаются только фото JPEG, PNG или WebP.');
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    return transaction(async (db) => {
      const shift = await lockShift(db, device, shiftPublicId);
      const existing = await db.query('SELECT shift_id, kind, sha256 FROM kiosk_shift_photos WHERE public_id = $1', [photoId]);
      if (existing.rowCount) {
        const photo = existing.rows[0];
        if (String(photo.shift_id) === String(shift.id) && photo.kind === kind && photo.sha256 === sha256) {
          return { photoId, stored: true, duplicate: true };
        }
        throw httpError(409, 'Идентификатор фото уже занят.');
      }
      if (shift.status !== 'open') throw httpError(409, 'Смена уже не открыта.');
      if (kind !== 'invoice' && shift[`${kind}_status`] === 'accepted') throw httpError(409, 'Документ уже принят.');
      const count = await db.query('SELECT COUNT(*)::int AS n FROM kiosk_shift_photos WHERE shift_id = $1 AND kind = $2', [shift.id, kind]);
      if (Number(count.rows[0].n) >= MAX_UPLOADS[kind]) throw httpError(429, 'Слишком много фото для этой смены.');
      await db.query(
        `INSERT INTO kiosk_shift_photos (public_id, shift_id, kind, content_type, byte_size, sha256, data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [photoId, shift.id, kind, contentType, data.length, sha256, data]
      );
      return { photoId, stored: true, duplicate: false };
    });
  }

  function normalizePhotoIds(value, max) {
    const ids = Array.isArray(value) ? value.map((id) => String(id || '').toLowerCase()) : [];
    if (!ids.length) throw httpError(400, 'Добавьте хотя бы одно фото.');
    if (ids.length > max) throw httpError(400, `Не больше ${max} фото за раз.`);
    if (new Set(ids).size !== ids.length || !ids.every((id) => ID_PATTERN.test(id))) throw httpError(400, 'Неверный список фото.');
    return ids;
  }

  async function loadPhotos(db, shiftId, kind, ids, { withData = false } = {}) {
    const result = await db.query(
      `SELECT public_id, content_type, submitted_at${withData ? ', data' : ''}
       FROM kiosk_shift_photos WHERE shift_id = $1 AND kind = $2 AND public_id = ANY($3::text[])`,
      [shiftId, kind, ids]
    );
    if (result.rowCount !== ids.length) throw httpError(409, 'Не все фото загружены на сервер. Повторите отправку.', { code: 'photos_missing' });
    const byId = new Map(result.rows.map((row) => [row.public_id, row]));
    return ids.map((id) => byId.get(id));
  }

  async function submitInvoices(device, shiftPublicId, photoIds) {
    const ids = normalizePhotoIds(photoIds, MAX_INVOICES_PER_SUBMIT);
    const result = await transaction(async (db) => {
      const shift = await lockShift(db, device, shiftPublicId);
      const photos = await loadPhotos(db, shift.id, 'invoice', ids);
      if (photos.every((photo) => photo.submitted_at)) return { accepted: true, sent: ids.length, duplicate: true };
      await db.query(
        'UPDATE kiosk_shift_photos SET submitted_at = NOW() WHERE shift_id = $1 AND public_id = ANY($2::text[]) AND submitted_at IS NULL',
        [shift.id, ids]
      );
      await recordEvent(db, { shiftId: shift.id, deviceId: device.id, type: 'invoices_submitted', details: { count: ids.length } });
      const batchKey = crypto.createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 24);
      await enqueue(db, 'telegram', `invoices:${shift.public_id}:${batchKey}`, {
        type: 'photos', photoIds: ids, caption: invoicesCaption(shift, ids.length)
      });
      return { accepted: true, sent: ids.length, duplicate: false };
    });
    kickOutbox();
    return result;
  }

  async function submitDocument(device, shiftPublicId, kind, photoIds, manual) {
    if (kind === 'invoice') return submitInvoices(device, shiftPublicId, photoIds);
    if (kind !== 'report' && kind !== 'receipt') throw httpError(404, 'Неизвестный тип документа.');
    const ids = normalizePhotoIds(photoIds, MAX_PHOTOS_PER_CHECK);
    const statusColumn = `${kind}_status`;
    const pendingColumn = `${kind}_pending_since`;

    const claim = await transaction(async (db) => {
      const shift = await lockShift(db, device, shiftPublicId);
      if (shift.status !== 'open') throw httpError(409, 'Смена уже не открыта.');
      if (shift[statusColumn] === 'accepted') {
        return { done: kind === 'report' ? shift.report_validation : shift.receipt_validation };
      }
      if (shift[statusColumn] === 'pending' && shift[pendingColumn]
        && now() - new Date(shift[pendingColumn]).getTime() < PENDING_LOCK_MS) {
        throw httpError(409, 'Документ уже проверяется. Подождите.', { code: 'validation_in_progress', retryable: true });
      }
      const photos = await loadPhotos(db, shift.id, kind, ids, { withData: true });
      const previousStatus = shift[statusColumn] === 'pending' ? 'missing' : shift[statusColumn];
      await db.query(
        `UPDATE kiosk_shifts SET ${statusColumn} = 'pending', ${pendingColumn} = NOW(), updated_at = NOW() WHERE id = $1`,
        [shift.id]
      );
      return { shift, photos, previousStatus };
    });
    if (claim.done) return { ...claim.done, duplicate: true };

    const { shift, photos, previousStatus } = claim;
    let raw;
    let decision;
    try {
      if (skipAiCheck) {
        // Owner switched the AI check off: photos are accepted as sent and reach the chat when the shift closes.
        raw = { mode: 'ai_check_skipped' };
        decision = { accepted: true, fields: kind === 'report' ? manualReportFields(manual) : {}, signature_present: false, problems: [] };
      } else {
        if (!ai?.configured) throw new AiUnavailableError('AI validation is not configured', { retryable: false });
        raw = await ai.analyze(kind, photos.map((photo) => ({ data: photo.data, contentType: photo.content_type })));
        decision = kind === 'report' ? decideReport(raw) : decideReceipt(raw);
      }
    } catch (error) {
      await pool.query(
        `UPDATE kiosk_shifts SET ${statusColumn} = $2, ${pendingColumn} = NULL, updated_at = NOW() WHERE id = $1 AND ${statusColumn} = 'pending'`,
        [shift.id, previousStatus]
      );
      const notConfigured = error instanceof AiUnavailableError && !error.retryable && !ai?.configured;
      log.error?.('kiosk shift AI validation failed:', error?.message || 'unknown', error?.schemaErrors?.slice?.(0, 5) || '');
      throw httpError(
        notConfigured ? 503 : 502,
        notConfigured ? 'Проверка документов не настроена на сервере. Сообщите владельцу.' : 'Проверка временно недоступна. Фото сохранены — нажмите «Повторить».',
        { code: notConfigured ? 'ai_not_configured' : 'ai_unavailable', retryable: !notConfigured }
      );
    }

    const outcome = await transaction(async (db) => {
      const locked = await db.query('SELECT * FROM kiosk_shifts WHERE id = $1 FOR UPDATE', [shift.id]);
      const current = locked.rows[0];
      await db.query(
        `INSERT INTO kiosk_shift_validations (shift_id, kind, photo_ids, model, accepted, decision, raw_result)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7::jsonb)`,
        [shift.id, kind, JSON.stringify(ids), skipAiCheck ? null : (ai?.model || null), decision.accepted, JSON.stringify(decision), JSON.stringify(raw)]
      );
      await db.query(
        'UPDATE kiosk_shift_photos SET submitted_at = COALESCE(submitted_at, NOW()) WHERE shift_id = $1 AND public_id = ANY($2::text[])',
        [shift.id, ids]
      );
      if (current.status !== 'open' || current[statusColumn] !== 'pending') return { row: current, stale: true };
      const status = decision.accepted ? 'accepted' : 'rejected';
      const updated = kind === 'report'
        ? await db.query(
          `UPDATE kiosk_shifts SET report_status = $2, report_pending_since = NULL, report_validation = $3::jsonb,
             report_fields = CASE WHEN $2 = 'accepted' THEN $4::jsonb ELSE report_fields END,
             report_signature_present = $5,
             report_rejections = CASE WHEN $2 = 'accepted' THEN 0 ELSE report_rejections + 1 END,
             updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [shift.id, status, JSON.stringify(decision), JSON.stringify(decision.fields), decision.signature_present])
        : await db.query(
          `UPDATE kiosk_shifts SET receipt_status = $2, receipt_pending_since = NULL, receipt_validation = $3::jsonb,
             receipt_rejections = CASE WHEN $2 = 'accepted' THEN 0 ELSE receipt_rejections + 1 END,
             updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [shift.id, status, JSON.stringify(decision)]);
      const row = updated.rows[0];
      await recordEvent(db, {
        shiftId: shift.id, deviceId: device.id,
        type: decision.accepted ? `${kind}_accepted` : `${kind}_rejected`,
        details: { photos: ids.length, problems: decision.problems.map((problem) => problem.code) }
      });
      if (row.report_status === 'accepted' && row.receipt_status === 'accepted') {
        await enqueue(db, 'sheets', `sheet:${row.public_id}:documents`, { shiftPublicId: row.public_id });
      }
      const rejections = kind === 'report' ? row.report_rejections : row.receipt_rejections;
      if (!decision.accepted && rejections === TROUBLE_NOTIFY_AFTER) {
        await enqueue(db, 'telegram', `doc-trouble:${row.public_id}:${kind}`, { type: 'text', text: documentTroubleText(row, kind, decision.problems) });
      }
      return { row };
    });
    kickOutbox();
    if (outcome.stale) throw httpError(409, 'Смена изменилась во время проверки. Обновите экран.');
    return { ...decision, shift: publicShift(outcome.row) };
  }

  async function closeShift(device, shiftPublicId, body = {}) {
    const result = await transaction(async (db) => {
      const shift = await lockShift(db, device, shiftPublicId);
      if (shift.status === 'closed') return { row: shift, duplicate: true };
      if (shift.status !== 'open') throw httpError(409, 'Эта смена уже не открыта.');
      if (shift.report_status !== 'accepted' || shift.receipt_status !== 'accepted') {
        throw httpError(409, 'Документы не сданы. Завершить смену невозможно.', { code: 'documents_not_accepted' });
      }
      let closedAt = new Date(String(body.closedAt || ''));
      const openedMs = new Date(shift.opened_at).getTime();
      if (Number.isNaN(closedAt.getTime()) || closedAt.getTime() > now() + MAX_OPENED_AT_FUTURE_MS || closedAt.getTime() < openedMs) {
        closedAt = new Date(now());
      }
      const updated = await db.query(
        `UPDATE kiosk_shifts SET status = 'closed', closed_at = $2, closed_local_time = $3, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [shift.id, closedAt.toISOString(), barLocalParts(closedAt).time]
      );
      const row = updated.rows[0];
      await recordEvent(db, { shiftId: shift.id, deviceId: device.id, type: 'shift_closed', details: { closedLocalTime: row.closed_local_time } });
      await enqueue(db, 'telegram', `closed:${row.public_id}`, { type: 'shift_closed', shiftPublicId: row.public_id });
      await enqueue(db, 'sheets', `sheet:${row.public_id}:closed`, { shiftPublicId: row.public_id });
      return { row, duplicate: false };
    });
    kickOutbox();
    return { shift: publicShift(result.row), duplicate: result.duplicate };
  }

  // ---------- outbox ----------

  async function deliver(item) {
    const payload = item.payload || {};
    if (item.channel === 'sheets') {
      const shift = await pool.query('SELECT * FROM kiosk_shifts WHERE public_id = $1', [payload.shiftPublicId]);
      if (!shift.rowCount) return;
      await sheets.upsertShiftRow(withDisplayDate(shift.rows[0]));
      return;
    }
    if (payload.type === 'text') {
      await telegram.sendMessage(payload.text);
    } else if (payload.type === 'photos') {
      const photos = await pool.query(
        'SELECT data, content_type FROM kiosk_shift_photos WHERE public_id = ANY($1::text[]) ORDER BY created_at',
        [payload.photoIds]
      );
      await telegram.sendPhotos(photos.rows.map((row) => ({ data: row.data, contentType: row.content_type })), payload.caption);
    } else if (payload.type === 'shift_closed') {
      const result = await pool.query('SELECT * FROM kiosk_shifts WHERE public_id = $1', [payload.shiftPublicId]);
      const shift = result.rows[0];
      if (!shift) return;
      if (!telegram.configured) throw new NotConfiguredError('Telegram shift channel is not configured');
      await telegram.sendMessage(shiftClosedText(shift));
      const photos = await pool.query(
        `SELECT p.data, p.content_type FROM kiosk_shift_photos p
         JOIN kiosk_shift_validations v ON v.shift_id = p.shift_id AND v.accepted AND v.photo_ids ? p.public_id
         WHERE p.shift_id = $1 AND p.kind IN ('report', 'receipt')
         ORDER BY p.kind DESC, p.created_at`,
        [shift.id]
      );
      if (photos.rowCount) {
        await telegram.sendPhotos(photos.rows.map((row) => ({ data: row.data, contentType: row.content_type })),
          `Табель и чек — ${shift.employee_name}`);
      }
    }
  }

  async function drainOutbox({ limit = 10 } = {}) {
    if (!(await schemaReady())) return { processed: 0 };
    const claimed = await pool.query(
      `UPDATE kiosk_shift_outbox SET next_attempt_at = NOW() + INTERVAL '5 minutes', attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM kiosk_shift_outbox
         WHERE done_at IS NULL AND abandoned_at IS NULL AND next_attempt_at <= NOW()
         ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
      [limit]
    );
    let processed = 0;
    for (const item of claimed.rows) {
      try {
        await deliver(item);
        await pool.query('UPDATE kiosk_shift_outbox SET done_at = NOW(), last_error = NULL WHERE id = $1', [item.id]);
        processed += 1;
      } catch (error) {
        const expired = now() - new Date(item.created_at).getTime() > OUTBOX_MAX_AGE_MS || item.attempts >= 40;
        const notConfigured = error instanceof NotConfiguredError;
        const delaySeconds = notConfigured ? 15 * 60
          : Math.max(Number(error?.retryAfterSeconds || 0), Math.min(3600, 30 * 2 ** Math.min(item.attempts, 7)));
        await pool.query(
          `UPDATE kiosk_shift_outbox SET last_error = $2,
             next_attempt_at = NOW() + ($3::int * INTERVAL '1 second'),
             abandoned_at = CASE WHEN $4 THEN NOW() ELSE NULL END
           WHERE id = $1`,
          [item.id, String(error?.message || 'unknown').slice(0, 300), delaySeconds, expired]
        );
        if (notConfigured) log.warn?.('kiosk shift outbox channel not configured:', item.channel, error?.message || 'unknown');
        else log.error?.('kiosk shift outbox delivery failed:', item.channel, error?.message || 'unknown');
      }
    }
    return { processed, claimed: claimed.rowCount };
  }

  function kickOutbox() {
    if (draining) return draining;
    draining = drainOutbox().catch((error) => {
      log.error?.('kiosk shift outbox drain failed:', error?.message || 'unknown');
    }).finally(() => { draining = null; });
    return draining;
  }

  function configuration() {
    return {
      ai: Boolean(ai?.configured),
      telegram: Boolean(telegram?.configured),
      sheets: Boolean(sheets?.configured),
      enrollment: String(enrollCode || '').length >= 12
    };
  }

  return {
    schemaReady,
    enrollDevice,
    authenticate,
    startShift,
    getShift,
    listShifts,
    storePhoto,
    submitDocument,
    closeShift,
    drainOutbox,
    kickOutbox,
    configuration
  };
}
