/**
 * A show day end to end, using the app's own data code against the real
 * migrations served by PostgREST: an organiser sets up a class, the scribe
 * scores offline and syncs, the judge corrects and signs, a late upload is
 * refused, and the rider sees the sheet only once results are published.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

import { memoryStorage, SheetStore } from '../src/lib/offline/store';
import { syncSheets } from '../src/lib/offline/sync';
import { totalsByMovementId } from '../src/lib/scoring';
import { fetchBundle, fetchMyAssignments, saveSheet } from '../src/lib/scoringApi';

const REST = process.env.E2E_REST_URL!;
const SECRET = process.env.E2E_JWT_SECRET!;
const PGURL = process.env.E2E_PGURL!;

function jwt(sub: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}

/** A supabase-js client signed in as `userId`, talking to PostgREST directly. */
function clientFor(userId: string, url = REST): SupabaseClient {
  return createClient(url, 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwt(userId)}` },
      // Supabase serves PostgREST under /rest/v1; plain PostgREST serves it at /.
      fetch: (input, init) => fetch(String(input).replace('/rest/v1', ''), init),
    },
  });
}

function sql(query: string) {
  return execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-qAt', '-d', PGURL, '-c', query], { encoding: 'utf8' }).trim();
}

const ORG = randomUUID();
const JUDGE = randomUUID();
const SCRIBE = randomUUID();
const RIDER = randomUUID();
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const org = clientFor(ORG);
const judge = clientFor(JUDGE);
const scribe = clientFor(SCRIBE);
const rider = clientFor(RIDER);
// Nothing listens on this port: the tablet has no signal.
const scribeOffline = clientFor(SCRIBE, 'http://127.0.0.1:9');

let classJudgeId = '';
let classId = '';
let entryIds: string[] = [];
let movementIds: string[] = [];

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  sql(`insert into auth.users (id, email, raw_user_meta_data) values
    ('${ORG}', 'org@e2e.test', '{"full_name":"Olive Organiser"}'),
    ('${JUDGE}', 'judge@e2e.test', '{"full_name":"Jude Judge","roles":["judge"]}'),
    ('${SCRIBE}', 'scribe@e2e.test', '{"full_name":"Sam Scribe","roles":["scribe"]}'),
    ('${RIDER}', 'rider@e2e.test', '{"full_name":"Rita Rider","roles":["rider"]}')`);

  // Organiser sets up the club, test, show, class, panel and draw.
  const club = await ok(org.from('clubs').insert({ name: 'E2E Pony Club', created_by: ORG }).select('id').single());
  const test = await ok(
    org.from('test_templates').insert({ club_id: club.id, name: 'Prelim 1', code: 'P1', error_penalties: [2, 4] }).select('id').single(),
  );
  const movements = await ok(
    org
      .from('test_movements')
      .insert([
        { test_id: test.id, number: 1, markers: 'A X', description: 'Enter, halt, salute', coefficient: 1, is_collective: false },
        { test_id: test.id, number: 2, markers: 'C', description: 'Track right', coefficient: 1, is_collective: false },
        { test_id: test.id, number: 3, markers: null, description: 'Paces', coefficient: 2, is_collective: true },
      ])
      .select('id, number')
      .order('number'),
  );
  movementIds = movements.map((m) => m.id);
  const show = await ok(org.from('shows').insert({ club_id: club.id, name: 'E2E Show', show_date: tomorrow }).select('id').single());
  const arena = await ok(org.from('arenas').insert({ show_id: show.id, name: 'Arena 1', size: '20x40' }).select('id').single());
  const cls = await ok(
    org.from('classes').insert({ show_id: show.id, arena_id: arena.id, test_id: test.id, name: 'Prelim Open' }).select('id').single(),
  );
  classId = cls.id;
  const cj = await ok(
    org.from('class_judges').insert({ class_id: cls.id, judge_id: JUDGE, scribe_id: SCRIBE, position: 'C' }).select('id').single(),
  );
  classJudgeId = cj.id;
  const entries = await ok(
    org
      .from('entries')
      .insert([
        { class_id: cls.id, rider_id: RIDER, rider_name: 'Rita Rider', horse_name: 'Biscuit', draw_order: 1 },
        { class_id: cls.id, rider_id: null, rider_name: 'Ann Able', horse_name: 'Pickle', draw_order: 2 },
      ])
      .select('id')
      .order('draw_order'),
  );
  entryIds = entries.map((e) => e.id);
});

describe('a dressage class, end to end', () => {
  const scribeStore = new SheetStore(memoryStorage(), 'scribe');
  const judgeStore = new SheetStore(memoryStorage(), 'judge');

  it("lists the class on the scribe's and the judge's devices", async () => {
    const forScribe = await fetchMyAssignments(scribe, SCRIBE);
    expect(forScribe).toHaveLength(1);
    expect(forScribe[0]).toMatchObject({ judgeName: 'Jude Judge', scribeName: 'Sam Scribe', cls: { name: 'Prelim Open' } });
    expect(forScribe[0].test.error_penalties).toEqual([2, 4]);
    expect(await fetchMyAssignments(judge, JUDGE)).toHaveLength(1);
    expect(await fetchMyAssignments(rider, RIDER)).toHaveLength(0);
  });

  it('downloads the test and the draw', async () => {
    const bundle = await fetchBundle(scribe, classJudgeId);
    expect(bundle.movements.map((m) => [m.number, m.coefficient, m.max_mark])).toEqual([
      [1, 1, 10],
      [2, 1, 10],
      [3, 2, 10],
    ]);
    expect(bundle.entries.map((e) => e.horse_name)).toEqual(['Biscuit', 'Pickle']);
    expect(bundle.sheets).toEqual([]);
  });

  it('keeps marks on the tablet with no signal, then uploads them', async () => {
    const [m1, m2, m3] = movementIds;
    scribeStore.edit(classJudgeId, entryIds[0], { type: 'mark', movementId: m1, mark: 6.5 });
    scribeStore.edit(classJudgeId, entryIds[0], { type: 'comment', movementId: m1, comment: 'Crooked halt' });
    scribeStore.edit(classJudgeId, entryIds[0], { type: 'mark', movementId: m2, mark: 7 });
    scribeStore.edit(classJudgeId, entryIds[0], { type: 'mark', movementId: m3, mark: 7.5 });
    scribeStore.edit(classJudgeId, entryIds[0], { type: 'errorsOfCourse', value: 1 });

    const offline = await syncSheets(scribeStore, (p) => saveSheet(scribeOffline, p));
    expect(offline).toEqual({ uploaded: 0, rejected: 0, offline: true });
    expect(scribeStore.pending()).toHaveLength(1);
    expect(sql(`select count(*) from score_sheets where entry_id = '${entryIds[0]}'`)).toBe('0');

    scribeStore.edit(classJudgeId, entryIds[0], { type: 'status', value: 'submitted' });
    const online = await syncSheets(scribeStore, (p) => saveSheet(scribe, p));
    expect(online).toEqual({ uploaded: 1, rejected: 0, offline: false });
    expect(scribeStore.pending()).toHaveLength(0);
    expect(sql(`select status || ':' || errors_of_course from score_sheets where entry_id = '${entryIds[0]}'`)).toBe('submitted:1');
    expect(sql(`select string_agg(mark::text, ',' order by mark) from movement_scores ms join score_sheets s on s.id = ms.sheet_id where s.entry_id = '${entryIds[0]}'`)).toBe('6.5,7,7.5');
  });

  it('lets the judge correct a mark and sign on their own device', async () => {
    const bundle = await fetchBundle(judge, classJudgeId);
    judgeStore.mergeFromServer(bundle.sheets);
    const sheet = judgeStore.get(classJudgeId, entryIds[0])!;
    expect(sheet.marks[movementIds[0]]).toMatchObject({ mark: 6.5, comment: 'Crooked halt' });

    judgeStore.edit(classJudgeId, entryIds[0], { type: 'mark', movementId: movementIds[1], mark: 8 });
    judgeStore.edit(classJudgeId, entryIds[0], { type: 'status', value: 'signed' });
    expect(await syncSheets(judgeStore, (p) => saveSheet(judge, p))).toMatchObject({ uploaded: 1 });

    const signed = judgeStore.get(classJudgeId, entryIds[0])!;
    expect(signed.status).toBe('signed');
    expect(signed.signedAt).not.toBeNull();
    expect(sql(`select signed_by from score_sheets where entry_id = '${entryIds[0]}'`)).toBe(JUDGE);

    // The app's totals match the database's: 6.5 + 8 + 7.5×2 = 29.5 of 40, less 2.
    const local = totalsByMovementId(bundle.movements, signed.marks, { errorsOfCourse: 1, errorPenalties: [2, 4] });
    expect(local).toMatchObject({ rawPoints: 29.5, maxPoints: 40, finalPoints: 27.5, percentage: 68.75 });
    const db = await ok(judge.from('score_sheet_totals').select('*').eq('entry_id', entryIds[0]).single());
    expect([Number(db.raw_points), Number(db.max_points), Number(db.error_penalty)]).toEqual([29.5, 40, 2]);
  });

  it("refuses a late scribe edit to the signed sheet and says so on the tablet", async () => {
    scribeStore.edit(classJudgeId, entryIds[0], { type: 'mark', movementId: movementIds[0], mark: 10 });
    const result = await syncSheets(scribeStore, (p) => saveSheet(scribe, p));
    expect(result).toEqual({ uploaded: 0, rejected: 1, offline: false });
    expect(scribeStore.rejected()[0].rejected?.message).toMatch(/signed/);
    expect(sql(`select max(mark) from movement_scores ms join score_sheets s on s.id = ms.sheet_id where s.entry_id = '${entryIds[0]}'`)).toBe('8');

    // Refreshing the draw replaces the refused copy with the signed one.
    scribeStore.mergeFromServer((await fetchBundle(scribe, classJudgeId)).sheets);
    expect(scribeStore.get(classJudgeId, entryIds[0])).toMatchObject({ status: 'signed', rejected: null });
    expect(scribeStore.get(classJudgeId, entryIds[0])!.marks[movementIds[1]].mark).toBe(8);
  });

  it('stops the scribe signing', async () => {
    scribeStore.edit(classJudgeId, entryIds[1], { type: 'mark', movementId: movementIds[0], mark: 6 });
    scribeStore.edit(classJudgeId, entryIds[1], { type: 'status', value: 'signed' });
    expect(await syncSheets(scribeStore, (p) => saveSheet(scribe, p))).toMatchObject({ rejected: 1 });
    expect(sql(`select count(*) from score_sheets where entry_id = '${entryIds[1]}'`)).toBe('0');
  });

  it('shows the rider their sheet only once results are published', async () => {
    expect(await ok(rider.from('score_sheets').select('id'))).toHaveLength(0);
    await ok(org.from('classes').update({ results_published: true }).eq('id', classId));
    const sheets = await ok(rider.from('score_sheets').select('status, movement_scores(mark, comment)'));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].movement_scores).toHaveLength(3);
  });
});
