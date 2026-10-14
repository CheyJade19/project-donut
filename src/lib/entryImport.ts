import { combineDateTime } from './format';
import { parseCsvRows } from './testImport';

export type EntryDraft = {
  rider_name: string;
  horse_name: string;
  draw_order: number | null;
  start_time: string | null;
};

const COLUMNS: Record<keyof EntryDraft, string[]> = {
  rider_name: ['rider', 'rider name', 'name', 'competitor'],
  horse_name: ['horse', 'horse name'],
  draw_order: ['draw', 'order', 'no', 'number', '#', 'draw order'],
  start_time: ['time', 'start', 'start time', 'ride time'],
};

/**
 * Reads a draw from CSV: one row per rider with rider and horse names, and
 * optionally the draw number and ride time (HH:MM, on the show date). Without
 * a header row the columns are taken as rider, horse, draw, time.
 */
export function parseEntriesCsv(text: string, showDate: string): { entries: EntryDraft[]; errors: string[] } {
  const rows = parseCsvRows(text).filter((r) => r.some((c) => c.trim()));
  const errors: string[] = [];
  if (rows.length === 0) return { entries: [], errors: ['The file is empty.'] };

  const header = rows[0].map((c) => c.trim().toLowerCase());
  const index = {} as Record<keyof EntryDraft, number>;
  for (const key of Object.keys(COLUMNS) as (keyof EntryDraft)[]) {
    index[key] = header.findIndex((h) => COLUMNS[key].includes(h));
  }
  const hasHeader = index.rider_name !== -1 || index.horse_name !== -1;
  if (!hasHeader) Object.assign(index, { rider_name: 0, horse_name: 1, draw_order: 2, start_time: 3 });
  else if (index.rider_name === -1 || index.horse_name === -1) {
    return { entries: [], errors: ['The header needs both a "rider" and a "horse" column.'] };
  }

  const entries: EntryDraft[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((row, i) => {
    const line = i + (hasHeader ? 2 : 1);
    const cell = (k: keyof EntryDraft) => (index[k] >= 0 ? (row[index[k]] ?? '').trim() : '');
    const rider = cell('rider_name');
    const horse = cell('horse_name');
    if (!rider || !horse) {
      errors.push(`Row ${line}: needs a rider and a horse, skipped.`);
      return;
    }
    let draw: number | null = null;
    if (cell('draw_order')) {
      draw = Number(cell('draw_order'));
      if (!Number.isInteger(draw) || draw < 1) {
        errors.push(`Row ${line}: draw "${cell('draw_order')}" is not a whole number, left blank.`);
        draw = null;
      }
    }
    let start: string | null = null;
    if (cell('start_time')) {
      start = combineDateTime(showDate, cell('start_time'));
      if (!start) errors.push(`Row ${line}: time "${cell('start_time')}" should look like 09:30, left blank.`);
    }
    entries.push({ rider_name: rider, horse_name: horse, draw_order: draw, start_time: start });
  });

  // Riders without a draw number go after the numbered ones, in file order.
  let next = Math.max(0, ...entries.map((e) => e.draw_order ?? 0));
  for (const e of entries) if (e.draw_order == null) e.draw_order = ++next;

  return { entries, errors };
}
