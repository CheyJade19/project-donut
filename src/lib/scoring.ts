import type { MovementDraft } from './types';

export type SheetTotals = {
  rawPoints: number;
  maxPoints: number;
  errorPenalty: number;
  otherDeductions: number;
  finalPoints: number;
  /** Final points as a percentage of the maximum, rounded to 3 decimals. */
  percentage: number;
  eliminated: boolean;
  /** Movements without a mark yet. */
  missing: number;
};

type Scorable = Pick<MovementDraft, 'number' | 'coefficient' | 'max_mark'>;

/**
 * Totals for one judge's sheet. Marks are keyed by movement number. Errors of
 * course cost error_penalties[0], then [1], ...; one more error than the list
 * covers eliminates the combination.
 */
export function computeSheetTotals(
  movements: Scorable[],
  marks: Record<number, number | null | undefined>,
  options: { errorsOfCourse?: number; errorPenalties?: number[]; otherDeductions?: number } = {},
): SheetTotals {
  const { errorsOfCourse = 0, errorPenalties = [2, 4], otherDeductions = 0 } = options;

  let rawPoints = 0;
  let maxPoints = 0;
  let missing = 0;
  for (const m of movements) {
    maxPoints += m.max_mark * m.coefficient;
    const mark = marks[m.number];
    if (mark == null) missing += 1;
    else rawPoints += mark * m.coefficient;
  }

  const eliminated = errorsOfCourse > errorPenalties.length;
  const errorPenalty = eliminated
    ? 0
    : errorPenalties.slice(0, errorsOfCourse).reduce((sum, p) => sum + p, 0);
  const finalPoints = eliminated ? 0 : Math.max(0, rawPoints - errorPenalty - otherDeductions);
  const percentage =
    maxPoints === 0 || eliminated ? 0 : Math.round((finalPoints / maxPoints) * 100_000) / 1000;

  return { rawPoints, maxPoints, errorPenalty, otherDeductions, finalPoints, percentage, eliminated, missing };
}

/** Sum of max mark x coefficient across the test. */
export function maxTestPoints(movements: Scorable[]): number {
  return movements.reduce((sum, m) => sum + m.max_mark * m.coefficient, 0);
}

export function isValidMark(mark: number): boolean {
  return mark >= 0 && mark <= 10 && Number.isInteger(mark * 2);
}
