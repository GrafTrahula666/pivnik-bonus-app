// Bar-local time rules for kiosk shifts. The bar works in Europe/Moscow.
export const BAR_TIME_ZONE = 'Europe/Moscow';
// 11:00:00 exactly is already late.
export const LATE_FROM_SECONDS = 11 * 60 * 60;

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BAR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

export function barLocalParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('invalid date');
  const parts = Object.fromEntries(partsFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    displayDate: `${parts.day}.${parts.month}.${parts.year}`,
    time: `${parts.hour}:${parts.minute}`,
    secondsOfDay: Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)
  };
}

export function isLateStart(value) {
  return barLocalParts(value).secondsOfDay >= LATE_FROM_SECONDS;
}
