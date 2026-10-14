/**
 * Results end to end, through the app's own data code against PostgREST: two
 * judges sign sheets, the leaderboard averages them, the organiser opens the
 * live scoreboard and then publishes, and the rider reads both judges' marks
 * and comments and gets the PDF version of their sheet.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

import { fetchEntryResult, fetchLeaderboard, fetchMyResults, fetchResultClasses } from '../src/lib/results';
import { saveSheet } from '../src/lib/scoringApi';
import { scoreSheetHtml } from '../src/lib/sheetPdf';

const REST = process.env.E2E_REST_URL!;
const SECRET = process.env.E2E_JWT_SECRET!;
const PGURL = process.env.E2E_PGURL!;

function jwt(sub: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

function clientFor(userId: string): SupabaseClient {
  return createClient(REST, 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwt(userId)}` },
      fetch: (input, init) => fetch(String(input).replace('/rest/v1', ''), init),
    },
  });
}

function sql(query: string) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qAt', '-d', PGURL, '-c', query], { encoding: 'utf8' }).trim();
}

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await p;
  if (error || data == null) throw new Error(error?.message ?? 'No data');
  return data;
}

const ORG = randomUUID();
const JUDGE_C = randomUUID();
const JUDGE_E = randomUUID();
const RIDER = randomUUID();
const PUBLIC = randomUUID();
const today = new Date().toISOString().slice(0, 10);

const org = clientFor(ORG);
const judgeC = clientFor(JUDGE_C);
const judgeE = clientFor(JUDGE_E);
const rider = clientFor(RIDER);
const spectator = clientFor(PUBLIC);

let classId = '';
let panelC = '';
let panelE = '';
let entries: Record<string, string> = {};
let movementIds: string[] = [];

/** One judge's signed sheet, uploaded the way the app does it. */
async function sign(client: SupabaseClient, panel: string, entry: string, marks: [number, number, number], comment?: string) {
  const at = new Date().toISOString();
  const result = await saveSheet(client, {
    entry_id: entries[entry],
    class_judge_id: panel,
    status: 'signed',
    errors_of_course: 0,
    other_deductions: 0,
    eliminated: false,
    general_comment: comment ?? null,
    client_updated_at: at,
    marks: marks.map((mark, i) => ({ movement_id: movementIds[i], mark, comment: i === 0 ? `${entry} halt` : null, client_updated_at: at })),
  });
  if (!result.ok) throw new Error(result.message);
}

beforeAll(async () => {
  sql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ORG}', 'org@results.test', '{"full_name":"Olive Organiser"}'),
    ('${JUDGE_C}', 'c@results.test', '{"full_name":"Cleo Chief","roles":["judge"]}'),
    ('${JUDGE_E}', 'e@results.test', '{"full_name":"Eve Side","roles":["judge"]}'),
    ('${RIDER}', 'rider@results.test', '{"full_name":"Rosa Rider","roles":["rider"]}'),
    ('${PUBLIC}', 'fan@results.test', '{"full_name":"Fran Fan","roles":["rider"]}')`);

  const club = await ok(org.from('clubs').insert({ name: 'Results Club', created_by: ORG }).select('id').single());
  const test = await ok(org.from('test_templates').insert({ club_id: club.id, name: 'Novice 2', code: 'N2' }).select('id').single());
  const movements = await ok(
    org
      .from('test_movements')
      .insert([
        { test_id: test.id, number: 1, markers: 'A X', description: 'Enter, halt, salute', coefficient: 1, is_collective: false },
        { test_id: test.id, number: 2, markers: 'C', description: 'Track left', coefficient: 1, is_collective: false },
        { test_id: test.id, number: 3, markers: null, description: 'Paces', coefficient: 2, is_collective: true },
      ])
      .select('id, number')
      .order('number'),
  );
  movementIds = movements.map((m) => m.id);
  const show = await ok(org.from('shows').insert({ club_id: club.id, name: 'Results Show', show_date: today }).select('id').single());
  const cls = await ok(org.from('classes').insert({ show_id: show.id, test_id: test.id, name: 'Novice Champs' }).select('id').single());
  classId = cls.id;
  const panel = await ok(
    org
      .from('class_judges')
      .insert([
        { class_id: classId, judge_id: JUDGE_C, position: 'C' },
        { class_id: classId, judge_id: JUDGE_E, position: 'E' },
      ])
      .select('id, position')
      .order('position'),
  );
  [panelC, panelE] = panel.map((p) => p.id);
  const rows = await ok(
    org
      .from('entries')
      .insert([
        { class_id: classId, rider_id: RIDER, rider_name: 'Rosa Rider', horse_name: 'Fudge', draw_order: 1 },
        { class_id: classId, rider_id: null, rider_name: 'Ben Bold', horse_name: 'Rocket', draw_order: 2 },
        { class_id: classId, rider_id: null, rider_name: 'Cal Late', horse_name: 'Willow', draw_order: 3 },
      ])
      .select('id, horse_name'),
  );
  entries = Object.fromEntries(rows.map((r) => [r.horse_name, r.id]));
});

describe('results, end to end', () => {
  it('averages the judges as sheets are signed', async () => {
    await sign(judgeC, panelC, 'Fudge', [7, 7, 7], 'Forward and through');
    await sign(judgeC, panelC, 'Rocket', [6, 6, 6]);
    let board = await fetchLeaderboard(judgeC, classId);
    expect(board.map((r) => [r.horse_name, r.place, r.average_percentage, r.is_final])).toEqual([
      ['Fudge', 1, 70, false],
      ['Rocket', 2, 60, false],
      ['Willow', null, null, false],
    ]);

    await sign(judgeE, panelE, 'Fudge', [6, 6, 6]);
    await sign(judgeE, panelE, 'Rocket', [8, 8, 7.5]);
    board = await fetchLeaderboard(judgeE, classId);
    // Fudge (70 + 60) / 2 = 65; Rocket (60 + 77.5) / 2 = 68.75.
    expect(board.map((r) => [r.horse_name, r.place, r.average_percentage, r.is_final])).toEqual([
      ['Rocket', 1, 68.75, true],
      ['Fudge', 2, 65, true],
      ['Willow', null, null, false],
    ]);
    expect(board[0].judges.map((j) => [j.position, j.judge_name, j.percentage])).toEqual([
      ['C', 'Cleo Chief', 60],
      ['E', 'Eve Side', 77.5],
    ]);
  });

  it('keeps the scoreboard private until the organiser opens it', async () => {
    expect(await fetchLeaderboard(spectator, classId)).toEqual([]);
    expect((await fetchResultClasses(spectator)).map((c) => c.id)).not.toContain(classId);

    const before = sql(`select results_updated_at from classes where id = '${classId}'`);
    expect((await org.from('classes').update({ leaderboard_public: true }).eq('id', classId)).error).toBeNull();
    expect((await fetchLeaderboard(spectator, classId)).map((r) => r.horse_name)).toEqual(['Rocket', 'Fudge', 'Willow']);
    expect((await fetchResultClasses(spectator)).map((c) => c.id)).toContain(classId);

    // The live scoreboard does not open the sheets themselves.
    expect(await fetchMyResults(rider)).toEqual([]);
    expect(await ok(rider.from('score_sheets').select('id'))).toHaveLength(0);

    // A late signature bumps the class row the app listens to.
    await sign(judgeC, panelC, 'Willow', [5, 5, 5]);
    expect(sql(`select results_updated_at > '${before}' from classes where id = '${classId}'`)).toBe('t');
  });

  it("shows the rider each judge's marks and comments once published", async () => {
    expect((await org.from('classes').update({ results_published: true }).eq('id', classId)).error).toBeNull();

    const mine = await fetchMyResults(rider);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ place: 2, average_percentage: 65, is_final: true, placed_count: 3 });
    expect(mine[0].cls.name).toBe('Novice Champs');
    expect(mine[0].entry.horse_name).toBe('Fudge');

    const result = await fetchEntryResult(rider, entries.Fudge);
    expect(result.judges.map((j) => [j.classJudge.position, j.judgeName, j.sheet?.status, j.totals?.percentage])).toEqual([
      ['C', 'Cleo Chief', 'signed', 70],
      ['E', 'Eve Side', 'signed', 60],
    ]);
    expect(result.judges[0].marks[movementIds[0]]).toEqual({ mark: 7, comment: 'Fudge halt' });
    expect(result.judges[0].sheet?.general_comment).toBe('Forward and through');
    // The app's own averaging agrees with the leaderboard's.
    expect(result.combined).toMatchObject({ averagePercentage: 65, signed: 2, total: 2 });

    const html = scoreSheetHtml(result, { place: mine[0].place, shared: false });
    expect(html).toContain('Rosa Rider · Fudge');
    expect(html).toContain('Judge at E: Eve Side');
    expect(html).toContain('Placed 2nd');
    expect(html).toContain('65.000%');
  });

  it("never shows a rider someone else's sheet", async () => {
    await expect(fetchEntryResult(spectator, entries.Rocket)).resolves.toMatchObject({
      judges: [{ sheet: null }, { sheet: null }],
    });
  });

  it('hides the sheets again if the organiser unpublishes', async () => {
    expect(
      (await org.from('classes').update({ results_published: false, leaderboard_public: false }).eq('id', classId)).error,
    ).toBeNull();
    expect(await fetchMyResults(rider)).toEqual([]);
    expect(await fetchLeaderboard(rider, classId)).toEqual([]);
  });
});
