/** "Sat 1 Nov" for a yyyy-mm-dd date, in the device's locale. */
export function formatDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "09:30" for a timestamp, in the device's time zone. */
export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatMark(mark: number | null | undefined) {
  if (mark == null) return '–';
  return Number.isInteger(mark) ? String(mark) : mark.toFixed(1);
}

export function formatPoints(points: number) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}

/** Combines a show date and "HH:MM" into a timestamp in the device's time zone. */
export function combineDateTime(isoDate: string, time: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(time.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 23 || min > 59) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}
