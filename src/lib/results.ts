import type { SupabaseClient } from '@supabase/supabase-js';

import { totalsByMovementId, type SheetTotals } from './scoring';
import type {
  Arena,
  ClassJudge,
  DressageClass,
  Entry,
  JudgePosition,
  MovementScore,
  ScoreSheet,
  SheetStatus,
  Show,
  TestMovement,
  TestTemplate,
} from './types';

// ---------------------------------------------------------------------------
// Leaderboard (computed by class_leaderboard() in the database)
// ---------------------------------------------------------------------------

export type LeaderboardJudge = {
  class_judge_id: string;
  position: JudgePosition;
  judge_name: string;
  status: SheetStatus | 'not_started';
  /** Null until this judge has signed. */
  final_points: number | null;
  percentage: number | null;
  eliminated: boolean | null;
};

export type LeaderboardRow = {
  entry_id: string;
  draw_order: number | null;
  rider_name: string;
  horse_name: string;
  rider_id: string | null;
  withdrawn: boolean;
  judges: LeaderboardJudge[];
  judges_signed: number;
  judges_total: number;
  /** Average of the signed judges' percentages. */
  average_percentage: number | null;
  total_points: number | null;
  collective_points: number | null;
  eliminated: boolean;
  /** Every judge has signed. */
  is_final: boolean;
  /** Null when not placed (no signed sheet yet, eliminated or withdrawn). */
  place: number | null;
};

const num = (v: unknown) => (v == null ? null : Number(v));

export async function fetchLeaderboard(client: SupabaseClient, classId: string): Promise<LeaderboardRow[]> {
  const { data, error } = await client.rpc('class_leaderboard', { target_class: classId });
  if (error) throw new Error(error.message);
  // Postgres numerics arrive as strings or numbers depending on size.
  return ((data ?? []) as LeaderboardRow[]).map((r) => ({
    ...r,
    average_percentage: num(r.average_percentage),
    total_points: num(r.total_points),
    collective_points: num(r.collective_points),
    judges: r.judges.map((j) => ({ ...j, final_points: num(j.final_points), percentage: num(j.percentage) })),
  }));
}

/** "1st", "2nd", "3rd", "11th", "=3rd" when shared. */
export function ordinal(place: number, shared = false) {
  const tens = place % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][place % 10] ?? 'th';
  return `${shared ? '=' : ''}${place}${suffix}`;
}

/** Places held by more than one rider. */
export function sharedPlaces(rows: Pick<LeaderboardRow, 'place'>[]): Set<number> {
  const seen = new Map<number, number>();
  for (const r of rows) if (r.place != null) seen.set(r.place, (seen.get(r.place) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([p]) => p));
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

type Publishable = Pick<DressageClass, 'results_published' | 'results_publish_at' | 'leaderboard_public'>;

/** Riders can see their sheets (published, or the scheduled time has passed). */
export function resultsArePublic(cls: Publishable, now = new Date()) {
  return cls.results_published || (cls.results_publish_at != null && new Date(cls.results_publish_at) <= now);
}

/** Who can see what, in words, for the organiser. */
export function publishingSummary(cls: Publishable, now = new Date()): string {
  if (resultsArePublic(cls, now)) return 'Results are public: everyone sees the leaderboard and riders see their sheets.';
  const live = cls.leaderboard_public ? 'Everyone sees the live scoreboard.' : 'Only you and the judges see the scoreboard.';
  const sheets = cls.results_publish_at
    ? `Riders' sheets go public at ${new Date(cls.results_publish_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`
    : "Riders' sheets are hidden.";
  return `${live} ${sheets}`;
}

// ---------------------------------------------------------------------------
// Classes with results to look at
// ---------------------------------------------------------------------------

export type ResultClass = DressageClass & {
  shows: Show;
  arenas: Pick<Arena, 'name'> | null;
  test_templates: Pick<TestTemplate, 'name' | 'code'>;
};

/** Classes from the last fortnight on whose scoreboard or results are open to everyone. */
export async function fetchResultClasses(client: SupabaseClient, now = new Date()): Promise<ResultClass[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await client
    .from('classes')
    .select('*, shows!inner(*), arenas(name), test_templates(name, code)')
    .gte('shows.show_date', since)
    .or(`leaderboard_public.eq.true,results_published.eq.true,results_publish_at.lte.${now.toISOString()}`);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ResultClass[]).sort(
    (a, b) =>
      b.shows.show_date.localeCompare(a.shows.show_date) ||
      (a.start_time ?? '').localeCompare(b.start_time ?? '') ||
      a.name.localeCompare(b.name),
  );
}

export type MyResult = {
  entry_id: string;
  class_id: string;
  place: number | null;
  average_percentage: number | null;
  eliminated: boolean;
  is_final: boolean;
  placed_count: number;
  entry: Entry;
  cls: ResultClass;
};

/** The signed-in rider's placings in classes whose results are public. */
export async function fetchMyResults(client: SupabaseClient): Promise<MyResult[]> {
  const { data, error } = await client.rpc('my_results');
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Omit<MyResult, 'entry' | 'cls'>[];
  if (rows.length === 0) return [];
  const { data: entries, error: entryError } = await client
    .from('entries')
    .select('*, classes!inner(*, shows!inner(*), arenas(name), test_templates(name, code))')
    .in('id', rows.map((r) => r.entry_id));
  if (entryError) throw new Error(entryError.message);
  const byId = new Map(((entries ?? []) as (Entry & { classes: ResultClass })[]).map((e) => [e.id, e]));
  return rows
    .filter((r) => byId.has(r.entry_id))
    .map((r) => {
      const { classes, ...entry } = byId.get(r.entry_id)!;
      return { ...r, average_percentage: num(r.average_percentage), entry, cls: classes };
    })
    .sort((a, b) => b.cls.shows.show_date.localeCompare(a.cls.shows.show_date) || a.cls.name.localeCompare(b.cls.name));
}

// ---------------------------------------------------------------------------
// One rider's sheets from every judge
// ---------------------------------------------------------------------------

export type JudgeSheet = {
  classJudge: ClassJudge;
  judgeName: string;
  /** Null when this judge has no sheet the viewer can see. */
  sheet: ScoreSheet | null;
  marks: Record<string, { mark: number | null; comment: string | null }>;
  totals: SheetTotals | null;
};

export type EntryResult = {
  entry: Entry;
  cls: DressageClass;
  show: Show;
  arena: Pick<Arena, 'name'> | null;
  test: TestTemplate;
  movements: TestMovement[];
  judges: JudgeSheet[];
  combined: CombinedResult;
};

export type CombinedResult = {
  /** Average of the signed, non-eliminated judges' percentages, to 3 decimals. */
  averagePercentage: number | null;
  totalPoints: number;
  eliminated: boolean;
  signed: number;
  total: number;
};

/**
 * Combines the judges' sheets the same way as class_leaderboard(): only
 * signed sheets count, percentages are averaged, and elimination by any
 * judge eliminates.
 */
export function combineJudges(sheets: { status: SheetStatus | null; totals: SheetTotals | null }[]): CombinedResult {
  const signed = sheets.filter((s) => s.status === 'signed' && s.totals);
  const eliminated = signed.some((s) => s.totals!.eliminated);
  const counted = signed.filter((s) => !s.totals!.eliminated);
  const averagePercentage =
    eliminated || counted.length === 0
      ? null
      : Math.round((counted.reduce((sum, s) => sum + s.totals!.percentage, 0) / counted.length) * 1000) / 1000;
  return {
    averagePercentage,
    totalPoints: signed.reduce((sum, s) => sum + s.totals!.finalPoints, 0),
    eliminated,
    signed: signed.length,
    total: sheets.length,
  };
}

type EntryRow = Entry & {
  classes: DressageClass & {
    shows: Show;
    arenas: Pick<Arena, 'name'> | null;
    test_templates: TestTemplate;
    class_judges: (ClassJudge & { judge: { full_name: string } | null })[];
  };
};

/**
 * Everything on one rider's sheets. Row level security decides what comes
 * back: riders get only signed sheets once results are public; organisers and
 * the panel get every sheet.
 */
export async function fetchEntryResult(client: SupabaseClient, entryId: string): Promise<EntryResult> {
  const head = await client
    .from('entries')
    .select(
      `*, classes!inner(*, shows!inner(*), arenas(name), test_templates(*),
        class_judges(*, judge:profiles!class_judges_judge_id_fkey(full_name)))`,
    )
    .eq('id', entryId)
    .single();
  if (head.error) throw new Error(head.error.message);
  const { classes, ...entry } = head.data as EntryRow;
  const { shows, arenas, test_templates, class_judges, ...cls } = classes;
  const test = { ...test_templates, error_penalties: test_templates.error_penalties.map(Number) };

  const [movementsRes, sheetsRes] = await Promise.all([
    client.from('test_movements').select('*').eq('test_id', test.id).order('number'),
    client.from('score_sheets').select('*, movement_scores(*)').eq('entry_id', entryId),
  ]);
  const failed = movementsRes.error ?? sheetsRes.error;
  if (failed) throw new Error(failed.message);

  const movements = ((movementsRes.data ?? []) as TestMovement[]).map((m) => ({ ...m, max_mark: Number(m.max_mark) }));
  const sheets = (sheetsRes.data ?? []) as (ScoreSheet & { movement_scores: MovementScore[] })[];

  const judges: JudgeSheet[] = [...class_judges]
    .sort((a, b) => a.position.localeCompare(b.position))
    .map(({ judge, ...classJudge }) => {
      const found = sheets.find((s) => s.class_judge_id === classJudge.id);
      const marks: JudgeSheet['marks'] = {};
      for (const ms of found?.movement_scores ?? []) {
        marks[ms.movement_id] = { mark: ms.mark == null ? null : Number(ms.mark), comment: ms.comment };
      }
      const sheet = found ? (({ movement_scores: _, ...s }) => ({ ...s, other_deductions: Number(s.other_deductions) }))(found) : null;
      const totals = sheet
        ? totalsByMovementId(movements, marks, {
            errorsOfCourse: sheet.errors_of_course,
            errorPenalties: test.error_penalties,
            otherDeductions: sheet.other_deductions,
            eliminated: sheet.eliminated,
          })
        : null;
      return { classJudge, judgeName: judge?.full_name || 'Judge', sheet, marks, totals };
    });

  return {
    entry,
    cls,
    show: shows,
    arena: arenas,
    test,
    movements,
    judges,
    combined: combineJudges(judges.map((j) => ({ status: j.sheet?.status ?? null, totals: j.totals }))),
  };
}
