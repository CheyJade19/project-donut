import type { MovementDraft } from './types';

/**
 * Parses a dressage test from CSV. The first row is a header; column names are
 * matched case-insensitively, so columns can be in any order:
 *
 *   number, markers, movement, directives, coefficient, max_mark, collective
 *
 * Only `movement` (or `description`) is required. Missing numbers are filled
 * in order, coefficient defaults to 1, max_mark to 10, and `collective` is
 * true for yes/y/true/1. See docs/test-template.csv.
 */
export function parseTestCsv(text: string): { movements: MovementDraft[]; errors: string[] } {
  const rows = parseCsvRows(text).filter((r) => r.some((cell) => cell.trim() !== ''));
  const errors: string[] = [];
  if (rows.length === 0) return { movements: [], errors: ['The file is empty.'] };

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const idx = {
    number: col('number', 'no', '#'),
    markers: col('markers', 'marker', 'letters'),
    description: col('movement', 'description', 'test'),
    directives: col('directives', 'directive_ideas', 'directive'),
    coefficient: col('coefficient', 'coef', 'coeff'),
    maxMark: col('max_mark', 'max', 'max_marks'),
    collective: col('collective', 'is_collective'),
  };
  if (idx.description === -1) {
    return { movements: [], errors: ['Missing a "movement" column in the header row.'] };
  }

  const movements: MovementDraft[] = [];
  const seen = new Set<number>();
  rows.slice(1).forEach((row, i) => {
    const line = i + 2;
    const get = (j: number) => (j === -1 ? '' : (row[j] ?? '').trim());

    const description = get(idx.description);
    if (!description) {
      errors.push(`Row ${line}: movement description is empty.`);
      return;
    }

    const numberText = get(idx.number);
    const number = numberText ? Number(numberText) : movements.length + 1;
    if (!Number.isInteger(number) || number < 1) {
      errors.push(`Row ${line}: "${numberText}" is not a valid movement number.`);
      return;
    }
    if (seen.has(number)) {
      errors.push(`Row ${line}: movement number ${number} appears twice.`);
      return;
    }

    const coefText = get(idx.coefficient);
    const coefficient = coefText ? Number(coefText) : 1;
    if (!Number.isInteger(coefficient) || coefficient < 1 || coefficient > 5) {
      errors.push(`Row ${line}: coefficient "${coefText}" must be a whole number from 1 to 5.`);
      return;
    }

    const maxText = get(idx.maxMark);
    const max_mark = maxText ? Number(maxText) : 10;
    if (!(max_mark > 0)) {
      errors.push(`Row ${line}: max mark "${maxText}" must be above 0.`);
      return;
    }

    seen.add(number);
    movements.push({
      number,
      markers: get(idx.markers) || null,
      description,
      directive_ideas: get(idx.directives) || null,
      coefficient,
      max_mark,
      is_collective: ['yes', 'y', 'true', '1'].includes(get(idx.collective).toLowerCase()),
    });
  });

  movements.sort((a, b) => a.number - b.number);
  return { movements, errors };
}

/** Minimal RFC 4180 CSV reader: quoted fields, escaped quotes, CRLF. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
