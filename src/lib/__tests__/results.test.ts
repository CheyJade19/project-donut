import { combineJudges, ordinal, publishingSummary, resultsArePublic, sharedPlaces, type EntryResult } from '../results';
import { computeSheetTotals } from '../scoring';
import { scoreSheetHtml, sheetFileName } from '../sheetPdf';

const movements = [
  { number: 1, coefficient: 1, max_mark: 10 },
  { number: 2, coefficient: 1, max_mark: 10 },
  { number: 3, coefficient: 2, max_mark: 10 },
];
const totals = (m1: number, m2: number, m3: number, errorsOfCourse = 0) =>
  computeSheetTotals(movements, { 1: m1, 2: m2, 3: m3 }, { errorsOfCourse });

describe('combineJudges', () => {
  it('averages the judges’ percentages', () => {
    const c = combineJudges([
      { status: 'signed', totals: totals(6, 7, 6) }, // 62.5
      { status: 'signed', totals: totals(8, 6, 7) }, // 70
    ]);
    expect(c).toEqual({ averagePercentage: 66.25, totalPoints: 53, eliminated: false, signed: 2, total: 2 });
  });

  it('only counts signed sheets', () => {
    const c = combineJudges([
      { status: 'signed', totals: totals(5, 5, 5) },
      { status: 'submitted', totals: totals(9, 9, 9) },
      { status: null, totals: null },
    ]);
    expect(c).toMatchObject({ averagePercentage: 50, signed: 1, total: 3 });
  });

  it('eliminates when any judge eliminated', () => {
    const c = combineJudges([
      { status: 'signed', totals: totals(6, 6, 6, 3) },
      { status: 'signed', totals: totals(6, 6, 6) },
    ]);
    expect(c).toMatchObject({ averagePercentage: null, eliminated: true });
  });

  it('rounds to three decimals like the database', () => {
    const c = combineJudges([
      { status: 'signed', totals: computeSheetTotals([{ number: 1, coefficient: 1, max_mark: 10 }, { number: 2, coefficient: 1, max_mark: 10 }, { number: 3, coefficient: 1, max_mark: 10 }], { 1: 7, 2: 7, 3: 6.5 }) },
      { status: 'signed', totals: totals(7, 7, 7) },
    ]);
    // 68.333 and 70 → 69.1665 → 69.167 (judge percentages are already rounded)
    expect(c.averagePercentage).toBe(69.167);
  });
});

describe('placings', () => {
  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map((n) => ordinal(n))).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st',
    ]);
    expect(ordinal(3, true)).toBe('=3rd');
  });

  it('finds shared places', () => {
    expect([...sharedPlaces([{ place: 1 }, { place: 3 }, { place: 3 }, { place: null }, { place: null }])]).toEqual([3]);
  });
});

describe('publishing', () => {
  const now = new Date('2026-11-01T15:00:00Z');
  it('is public when published or when the scheduled time has passed', () => {
    const base = { leaderboard_public: false, results_published: false, results_publish_at: null };
    expect(resultsArePublic(base, now)).toBe(false);
    expect(resultsArePublic({ ...base, results_published: true }, now)).toBe(true);
    expect(resultsArePublic({ ...base, results_publish_at: '2026-11-01T14:59:00Z' }, now)).toBe(true);
    expect(resultsArePublic({ ...base, results_publish_at: '2026-11-01T16:30:00Z' }, now)).toBe(false);
  });

  it('describes the settings for the organiser', () => {
    expect(publishingSummary({ leaderboard_public: false, results_published: false, results_publish_at: null }, now)).toBe(
      "Only you and the judges see the scoreboard. Riders' sheets are hidden.",
    );
    expect(publishingSummary({ leaderboard_public: true, results_published: false, results_publish_at: '2026-11-01T16:30:00Z' }, now)).toMatch(
      /^Everyone sees the live scoreboard\. Riders' sheets go public at /,
    );
    expect(publishingSummary({ leaderboard_public: false, results_published: true, results_publish_at: null }, now)).toMatch(/^Results are public/);
  });
});

describe('score sheet PDF', () => {
  const movementRows = [
    { id: 'm1', test_id: 't', number: 1, markers: 'A X', description: 'Enter <working> trot', directive_ideas: null, coefficient: 1, max_mark: 10, is_collective: false },
    { id: 'm2', test_id: 't', number: 2, markers: 'C', description: 'Track right', directive_ideas: null, coefficient: 1, max_mark: 10, is_collective: false },
    { id: 'm3', test_id: 't', number: 3, markers: null, description: 'Paces', directive_ideas: null, coefficient: 2, max_mark: 10, is_collective: true },
  ];
  const judge = (id: string, position: 'C' | 'E', name: string, status: 'signed' | 'submitted', marks: [number, number, number]) => {
    const t = computeSheetTotals(movements, { 1: marks[0], 2: marks[1], 3: marks[2] });
    return {
      classJudge: { id, class_id: 'c', judge_id: `j-${id}`, scribe_id: null, position },
      judgeName: name,
      sheet: {
        id: `s-${id}`, entry_id: 'e', class_judge_id: id, status, errors_of_course: 0, other_deductions: 0, eliminated: false,
        general_comment: 'Lovely & forward', signed_at: status === 'signed' ? '2026-11-01T10:00:00Z' : null, signed_by: null, client_updated_at: null,
      },
      marks: { m1: { mark: marks[0], comment: 'Crooked "halt"' }, m2: { mark: marks[1], comment: null }, m3: { mark: marks[2], comment: null } },
      totals: t,
    };
  };
  const result: EntryResult = {
    entry: { id: 'e', class_id: 'c', rider_id: null, rider_name: 'Rita Rider', horse_name: 'Biscuit', draw_order: 3, start_time: null, withdrawn: false },
    cls: { id: 'c', show_id: 's', arena_id: null, test_id: 't', name: 'Prelim Open', start_time: null, results_published: true, leaderboard_public: false, results_publish_at: null, results_updated_at: '' },
    show: { id: 's', club_id: 'k', name: 'Spring Dressage', venue: null, show_date: '2026-11-01', status: 'live' },
    arena: { name: 'Arena 1' },
    test: { id: 't', club_id: null, name: 'Prelim Test 1', code: 'P1', level: null, discipline: 'dressage', arena_size: null, error_penalties: [2, 4], notes: null, created_by: 'x', created_at: '' },
    movements: movementRows,
    judges: [judge('a', 'C', 'Jude Judge', 'signed', [6, 7, 6]), judge('b', 'E', 'Jill Judge', 'submitted', [8, 6, 7])],
    combined: { averagePercentage: 62.5, totalPoints: 25, eliminated: false, signed: 1, total: 2 },
  };

  it('prints every judge’s marks, comments and totals, escaped', () => {
    const html = scoreSheetHtml(result, { place: 2, shared: true });
    expect(html).toContain('Rita Rider · Biscuit');
    expect(html).toContain('Enter &lt;working&gt; trot');
    expect(html).toContain('Crooked &quot;halt&quot;');
    expect(html).toContain('Lovely &amp; forward');
    expect(html).toContain('Judge at C: Jude Judge');
    expect(html).toContain('Judge at E: Jill Judge');
    expect(html).toContain('Collective marks');
    expect(html).toContain('25 · 62.500%');
    expect(html).toContain('Placed =2nd');
    expect(html).toContain('Signed by Jude Judge');
    expect(html).toContain('Not yet signed by the judge');
    expect(html).not.toContain('<working>');
  });

  it('marks a result provisional while judges are still signing', () => {
    expect(scoreSheetHtml(result, null)).toContain('Provisional');
  });

  it('names the file after the class, rider and horse', () => {
    expect(sheetFileName(result)).toBe('Prelim-Open-Rita-Rider-Biscuit');
  });
});
