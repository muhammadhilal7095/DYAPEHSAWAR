let tz = 'Asia/Karachi';
export const setTimezone = (t: string) => (tz = t);

/** Date-only values are stored at UTC midnight → format in UTC so they never shift a day. */
export function fmtDate(d?: string | Date | null) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtDateTime(d?: string | Date | null) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const fmtNum = (n?: number | null) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
export const fmtMoney = (n?: number | null) => (n === null || n === undefined ? '—' : `PKR ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
export const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
export const humanize = (s?: string | null) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
export const toISODate = (d?: string | Date | null) => (d ? (typeof d === 'string' ? d : d.toISOString()).slice(0, 10) : '');
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const nightsBetween = (a?: string, b?: string) => (a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) : 0);
/** datetime-local value for "now" in the browser's zone */
export const nowLocalInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** '2026-10' → 'Oct 2026' (chart and table labels). */
export const fmtMonth = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ym);
