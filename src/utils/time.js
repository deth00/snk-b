export const LAO_TIME_ZONE = 'Asia/Vientiane';
export const LAO_DB_TIMEZONE = '+07:00';

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function laoNowSql(date = new Date()) {
  const laoDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return [
    laoDate.getUTCFullYear(),
    pad2(laoDate.getUTCMonth() + 1),
    pad2(laoDate.getUTCDate()),
  ].join('-') + ' ' + [
    pad2(laoDate.getUTCHours()),
    pad2(laoDate.getUTCMinutes()),
    pad2(laoDate.getUTCSeconds()),
  ].join(':');
}

export function laoTodaySql(date = new Date()) {
  return laoNowSql(date).slice(0, 10);
}

export function laoTodayCompact(date = new Date()) {
  return laoTodaySql(date).replace(/-/g, '');
}

export function parseLaoDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') return new Date(value);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(trimmed)) return new Date(trimmed);
  return new Date(`${trimmed.replace(' ', 'T')}${LAO_DB_TIMEZONE}`);
}
