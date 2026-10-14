import { computeSheetTotals, isValidMark, maxTestPoints } from '../scoring';

const movements = [
  { number: 1, coefficient: 1, max_mark: 10 },
  { number: 2, coefficient: 1, max_mark: 10 },
  { number: 3, coefficient: 2, max_mark: 10 },
];

describe('computeSheetTotals', () => {
  it('applies coefficients and computes the percentage', () => {
    const t = computeSheetTotals(movements, { 1: 6.5, 2: 7, 3: 7.5 });
    expect(t.rawPoints).toBe(28.5);
    expect(t.maxPoints).toBe(40);
    expect(t.percentage).toBe(71.25);
    expect(t.missing).toBe(0);
  });

  it('deducts errors of course cumulatively', () => {
    const t = computeSheetTotals(movements, { 1: 6, 2: 6, 3: 6 }, { errorsOfCourse: 2 });
    expect(t.errorPenalty).toBe(6);
    expect(t.finalPoints).toBe(18);
    expect(t.eliminated).toBe(false);
  });

  it('eliminates after one more error than the penalty list covers', () => {
    const t = computeSheetTotals(movements, { 1: 6, 2: 6, 3: 6 }, { errorsOfCourse: 3 });
    expect(t.eliminated).toBe(true);
    expect(t.percentage).toBe(0);
  });

  it('counts unmarked movements', () => {
    expect(computeSheetTotals(movements, { 1: 5 }).missing).toBe(2);
  });

  it('rounds the percentage to three decimals', () => {
    const t = computeSheetTotals([{ number: 1, coefficient: 1, max_mark: 30 }], { 1: 20 });
    expect(t.percentage).toBe(66.667);
  });
});

describe('helpers', () => {
  it('sums the maximum points', () => {
    expect(maxTestPoints(movements)).toBe(40);
  });

  it('accepts whole and half marks only', () => {
    expect(isValidMark(6.5)).toBe(true);
    expect(isValidMark(10)).toBe(true);
    expect(isValidMark(6.3)).toBe(false);
    expect(isValidMark(11)).toBe(false);
  });
});
