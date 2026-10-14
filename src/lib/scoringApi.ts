import type { SupabaseClient } from '@supabase/supabase-js';

import { fromServer, type LocalSheet, type SheetPayload } from './offline/sheets';
import type { KeyValueStorage } from './offline/store';
import type { SaveResult } from './offline/sync';
import type {
  Arena,
  ClassJudge,
  DressageClass,
  Entry,
  MovementScore,
  ScoreSheet,
  Show,
  TestMovement,
  TestTemplate,
} from './types';

/** One judge's panel in one class: what a scribe needs to score it offline. */
export type Assignment = {
  classJudge: ClassJudge;
  judgeName: string;
  scribeName: string | null;
  cls: DressageClass;
  show: Show;
  arena: Arena | null;
  test: TestTemplate;
};

export type AssignmentBundle = Assignment & {
  movements: TestMovement[];
  entries: Entry[];
  sheets: LocalSheet[];
  fetchedAt: string;
};

const ASSIGNMENT_SELECT = `*,
  judge:profiles!class_judges_judge_id_fkey(full_name),
  scribe:profiles!class_judges_scribe_id_fkey(full_name),
  classes!inner(*, shows!inner(*), arenas(*), test_templates(*))`;

type AssignmentRow = ClassJudge & {
  judge: { full_name: string } | null;
  scribe: { full_name: string } | null;
  classes: DressageClass & { shows: Show; arenas: Arena | null; test_templates: TestTemplate };
};

function toAssignment(row: AssignmentRow): Assignment {
  const { judge, scribe, classes, ...classJudge } = row;
  const { shows, arenas, test_templates, ...cls } = classes;
  return {
    classJudge,
    judgeName: judge?.full_name || 'Judge',
    scribeName: scribe?.full_name ?? null,
    cls,
    show: shows,
    arena: arenas,
    test: { ...test_templates, error_penalties: test_templates.error_penalties.map(Number) },
  };
}

/** Panels where this person is the judge or the scribe, from today on. */
export async function fetchMyAssignments(client: SupabaseClient, userId: string): Promise<Assignment[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await client
    .from('class_judges')
    .select(ASSIGNMENT_SELECT)
    .or(`judge_id.eq.${userId},scribe_id.eq.${userId}`)
    .gte('classes.shows.show_date', today);
  if (error) throw new Error(error.message);
  return ((data ?? []) as AssignmentRow[])
    .map(toAssignment)
    .sort(
      (a, b) =>
        a.show.show_date.localeCompare(b.show.show_date) ||
        (a.cls.start_time ?? '').localeCompare(b.cls.start_time ?? '') ||
        a.cls.name.localeCompare(b.cls.name),
    );
}

/** Everything needed to score one panel: test, draw and any saved sheets. */
export async function fetchBundle(client: SupabaseClient, classJudgeId: string): Promise<AssignmentBundle> {
  const head = await client.from('class_judges').select(ASSIGNMENT_SELECT).eq('id', classJudgeId).single();
  if (head.error) throw new Error(head.error.message);
  const assignment = toAssignment(head.data as AssignmentRow);

  const [movements, entries, sheets] = await Promise.all([
    client.from('test_movements').select('*').eq('test_id', assignment.test.id).order('number'),
    client
      .from('entries')
      .select('*')
      .eq('class_id', assignment.cls.id)
      .order('draw_order', { ascending: true, nullsFirst: false })
      .order('rider_name'),
    client.from('score_sheets').select('*, movement_scores(*)').eq('class_judge_id', classJudgeId),
  ]);
  const failed = movements.error ?? entries.error ?? sheets.error;
  if (failed) throw new Error(failed.message);

  return {
    ...assignment,
    movements: ((movements.data ?? []) as TestMovement[]).map((m) => ({
      ...m,
      max_mark: Number(m.max_mark),
    })),
    entries: (entries.data ?? []) as Entry[],
    sheets: ((sheets.data ?? []) as (ScoreSheet & { movement_scores: MovementScore[] })[]).map(
      ({ movement_scores, ...s }) => fromServer(s, movement_scores),
    ),
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Uploads one sheet. Errors are sorted into "try again later" (no signal,
 * server trouble, expired login) and "the server said no" (signed sheet, not
 * on the panel, invalid mark), which the scribe needs to see.
 */
export async function saveSheet(client: SupabaseClient, payload: SheetPayload): Promise<SaveResult> {
  try {
    const { data, error, status } = await client.rpc('save_score_sheet', { sheet: payload });
    if (!error) return { ok: true, sheet: data as ScoreSheet };
    const transient = status === 0 || status === 401 || status === 408 || status === 429 || status >= 500;
    return { ok: false, transient, message: error.message };
  } catch (e) {
    return { ok: false, transient: true, message: e instanceof Error ? e.message : String(e) };
  }
}

// Downloaded panels are kept on the device so scoring works with no signal.

const bundleKey = (userId: string, classJudgeId: string) => `eq.bundle.v1.${userId}.${classJudgeId}`;
const assignmentsKey = (userId: string) => `eq.assignments.v1.${userId}`;

export async function cacheBundle(storage: KeyValueStorage, userId: string, bundle: AssignmentBundle) {
  // Sheets live in the sheet store; the cached copy only needs the rest.
  await storage.setItem(bundleKey(userId, bundle.classJudge.id), JSON.stringify({ ...bundle, sheets: [] }));
}

export async function cachedBundle(storage: KeyValueStorage, userId: string, classJudgeId: string) {
  const raw = await storage.getItem(bundleKey(userId, classJudgeId));
  return raw ? (JSON.parse(raw) as AssignmentBundle) : null;
}

export async function cacheAssignments(storage: KeyValueStorage, userId: string, list: Assignment[]) {
  await storage.setItem(assignmentsKey(userId), JSON.stringify(list));
}

export async function cachedAssignments(storage: KeyValueStorage, userId: string) {
  const raw = await storage.getItem(assignmentsKey(userId));
  return raw ? (JSON.parse(raw) as Assignment[]) : null;
}
