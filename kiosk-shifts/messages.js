import { barLocalParts } from './time.js';

const DOC_STATUS = { missing: 'не сдан', pending: 'на проверке', rejected: 'не принят', accepted: 'принят' };

export function shiftOpenedText(shift) {
  const lines = [`${shift.employee_name} открыл(а) смену — ${shift.opened_local_time}`];
  if (shift.late) lines.push('ОПОЗДАНИЕ');
  return lines.join('\n');
}

export function previousShiftUnclosedText({ previousEmployeeName, previousOpenedAt, newShift }) {
  const lines = ['Предыдущая смена не была закрыта.'];
  if (previousEmployeeName || previousOpenedAt) {
    const when = previousOpenedAt ? barLocalParts(previousOpenedAt) : null;
    lines.push(`Незакрытая смена: ${previousEmployeeName || 'имя неизвестно'}${when ? `, ${when.displayDate} ${when.time}` : ''}`);
  }
  if (newShift) lines.push(`Новую смену открывает: ${newShift.employee_name} — ${newShift.opened_local_time}`);
  lines.push('Это только фиксация события. Решение о нарушении принимает владелец.');
  return lines.join('\n');
}

export function shiftClosedText(shift) {
  const f = shift.report_fields || {};
  const date = barLocalParts(shift.opened_at).displayDate;
  const line = (label, value) => `${label}: ${value || '—'}`;
  return [
    `Смена закрыта — ${shift.employee_name}`,
    `${date} · ${shift.opened_local_time} → ${shift.closed_local_time || '—'}${shift.late ? ' · ОПОЗДАНИЕ' : ''}`,
    '',
    line('Наличных в кассе при открытии', f.cash_open),
    line('Итого наличных', f.cash_total),
    line('Итого переводов', f.transfer_total),
    line('Общая выручка', f.revenue_total),
    line('Наличных в кассе при закрытии', f.cash_close),
    line('Зарплата', f.salary),
    line('Расходы на бар', f.bar_expenses),
    ...(f.inspector_comment ? [line('Комментарий проверяющего', f.inspector_comment)] : []),
    '',
    `Отчёт: ${DOC_STATUS[shift.report_status] || shift.report_status} · Чек: ${DOC_STATUS[shift.receipt_status] || shift.receipt_status}`,
    'Значения переписаны с табеля как есть, без пересчёта.'
  ].join('\n');
}

export function documentTroubleText(shift, kind, problems) {
  const title = kind === 'report' ? 'Табель' : 'Чек';
  const reasons = (problems || []).map((problem) => `• ${problem.message}`).slice(0, 5);
  return [
    `${title} не принимается уже ${kind === 'report' ? shift.report_rejections : shift.receipt_rejections} раз(а) подряд.`,
    `Смена: ${shift.employee_name}, открыта ${shift.opened_local_time}`,
    ...reasons
  ].join('\n');
}

export function invoicesCaption(shift, count) {
  return `Документы / накладные — ${shift.employee_name}, ${barLocalParts(shift.opened_at).displayDate} (${count} фото)`;
}
