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
  const values = [
    ['Наличных в кассе при открытии', f.cash_open],
    ['Итого наличных', f.cash_total],
    ['Итого переводов', f.transfer_total],
    ['Общая выручка', f.revenue_total],
    ['Наличных в кассе при закрытии', f.cash_close],
    ['Зарплата', f.salary],
    ['Расходы на бар', f.bar_expenses]
  ];
  // Without the AI check there are no recognised values: only times, lateness and the photos below.
  const hasValues = values.some(([, value]) => value);
  return [
    `Смена закрыта — ${shift.employee_name}`,
    `${date} · ${shift.opened_local_time} → ${shift.closed_local_time || '—'}${shift.late ? ' · ОПОЗДАНИЕ' : ''}`,
    ...(hasValues ? ['', ...values.map(([label, value]) => line(label, value))] : []),
    ...(f.inspector_comment ? [line('Комментарий проверяющего', f.inspector_comment)] : []),
    '',
    `Отчёт: ${DOC_STATUS[shift.report_status] || shift.report_status} · Чек: ${DOC_STATUS[shift.receipt_status] || shift.receipt_status}`,
    ...(hasValues ? ['Значения переписаны с табеля как есть, без пересчёта.'] : ['Табель и чек — на фото ниже.'])
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
