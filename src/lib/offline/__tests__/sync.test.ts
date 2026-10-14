import { applyEdit, emptySheet, fromServer, mergeServer, needsUpload, toPayload } from '../sheets';
import { memoryStorage, SheetStore } from '../store';
import { syncSheets, type SaveResult } from '../sync';
import type { ScoreSheet } from '../../types';

const CJ = 'cj-1';
const E1 = 'entry-1';
const E2 = 'entry-2';
const t = (min: number) => new Date(Date.UTC(2026, 10, 1, 9, min));

function serverRow(over: Partial<ScoreSheet> = {}): ScoreSheet {
  return {
    id: 'sheet-1',
    entry_id: E1,
    class_judge_id: CJ,
    status: 'draft',
    errors_of_course: 0,
    other_deductions: 0,
    eliminated: false,
    general_comment: null,
    signed_at: null,
    signed_by: null,
    client_updated_at: null,
    ...over,
  };
}

const okSave = (over: Partial<ScoreSheet> = {}) =>
  jest.fn(async (p: { entry_id: string; status: ScoreSheet['status'] }): Promise<SaveResult> => ({
    ok: true,
    sheet: serverRow({ entry_id: p.entry_id, id: `sheet-${p.entry_id}`, status: p.status, ...over }),
  }));

describe('applyEdit', () => {
  it('records marks with the time they were entered and bumps the version', () => {
    const s = applyEdit(emptySheet(CJ, E1), { type: 'mark', movementId: 'm1', mark: 6.5 }, t(1));
    expect(s.marks.m1).toEqual({ mark: 6.5, comment: null, editedAt: t(1).toISOString() });
    expect(s.version).toBe(1);
    expect(needsUpload(s)).toBe(true);
  });

  it('keeps the mark when a comment is added', () => {
    let s = applyEdit(emptySheet(CJ, E1), { type: 'mark', movementId: 'm1', mark: 7 }, t(1));
    s = applyEdit(s, { type: 'comment', movementId: 'm1', comment: 'Lacked bend' }, t(2));
    expect(s.marks.m1).toEqual({ mark: 7, comment: 'Lacked bend', editedAt: t(2).toISOString() });
  });

  it('does not change a signed sheet', () => {
    const signed = { ...emptySheet(CJ, E1), status: 'signed' as const };
    expect(applyEdit(signed, { type: 'mark', movementId: 'm1', mark: 10 })).toBe(signed);
  });

  it('never lets errors of course go negative', () => {
    expect(applyEdit(emptySheet(CJ, E1), { type: 'errorsOfCourse', value: -1 }).errorsOfCourse).toBe(0);
  });
});

describe('SheetStore', () => {
  it('keeps sheets across app restarts', async () => {
    const storage = memoryStorage();
    const a = new SheetStore(storage, 'k');
    a.edit(CJ, E1, { type: 'mark', movementId: 'm1', mark: 8 });
    await a.flush();

    const b = new SheetStore(storage, 'k');
    await b.load();
    expect(b.get(CJ, E1)?.marks.m1.mark).toBe(8);
    expect(b.pending()).toHaveLength(1);
  });

  it('starts empty instead of crashing on corrupt storage', async () => {
    const store = new SheetStore(memoryStorage({ k: '{not json' }), 'k');
    await store.load();
    expect(store.all()).toEqual([]);
  });
});

describe('syncSheets', () => {
  it('uploads queued sheets and marks them synced', async () => {
    const store = new SheetStore(memoryStorage(), 'k');
    store.edit(CJ, E1, { type: 'mark', movementId: 'm1', mark: 6 });
    store.edit(CJ, E2, { type: 'mark', movementId: 'm1', mark: 7 });
    const save = okSave();

    expect(await syncSheets(store, save)).toEqual({ uploaded: 2, rejected: 0, offline: false });
    expect(store.pending()).toHaveLength(0);
    expect(store.get(CJ, E1)?.serverId).toBe('sheet-entry-1');
    expect(save.mock.calls[0][0]).toMatchObject({
      entry_id: E1,
      class_judge_id: CJ,
      marks: [{ movement_id: 'm1', mark: 6 }],
    });
  });

  it('keeps everything queued when there is no signal, then sends it later', async () => {
    const store = new SheetStore(memoryStorage(), 'k');
    store.edit(CJ, E1, { type: 'mark', movementId: 'm1', mark: 6 });
    store.edit(CJ, E2, { type: 'mark', movementId: 'm1', mark: 7 });
    const offline = jest.fn(async (): Promise<SaveResult> => ({ ok: false, transient: true, message: 'Network request failed' }));

    expect(await syncSheets(store, offline)).toEqual({ uploaded: 0, rejected: 0, offline: true });
    expect(offline).toHaveBeenCalledTimes(1);
    expect(store.pending()).toHaveLength(2);

    expect((await syncSheets(store, okSave())).uploaded).toBe(2);
    expect(store.pending()).toHaveLength(0);
  });

  it('keeps an edit made while the upload was in flight queued', async () => {
    const store = new SheetStore(memoryStorage(), 'k');
    store.edit(CJ, E1, { type: 'mark', movementId: 'm1', mark: 6 });
    const save = jest.fn(async (p: { status: ScoreSheet['status'] }): Promise<SaveResult> => {
      store.edit(CJ, E1, { type: 'mark', movementId: 'm2', mark: 7 });
      return { ok: true, sheet: serverRow({ status: p.status }) };
    });

    await syncSheets(store, save);
    expect(store.get(CJ, E1)?.marks.m2.mark).toBe(7);
    expect(store.pending()).toHaveLength(1);
  });

  it('flags a sheet the server refuses and stops retrying it until it changes', async () => {
    const store = new SheetStore(memoryStorage(), 'k');
    store.edit(CJ, E1, { type: 'mark', movementId: 'm1', mark: 6 });
    const refuse = jest.fn(async (): Promise<SaveResult> => ({
      ok: false,
      transient: false,
      message: 'This score sheet is signed and locked',
    }));

    expect(await syncSheets(store, refuse)).toEqual({ uploaded: 0, rejected: 1, offline: false });
    expect(store.rejected()).toHaveLength(1);
    expect(store.pending()).toHaveLength(0);
    await syncSheets(store, refuse);
    expect(refuse).toHaveBeenCalledTimes(1);
  });

  it('takes the status the server reports, such as a sheet reopened by an organiser', async () => {
    const store = new SheetStore(memoryStorage(), 'k');
    store.edit(CJ, E1, { type: 'status', value: 'signed' });
    await syncSheets(store, okSave({ signed_at: '2026-11-01T09:10:00Z' }));
    expect(store.get(CJ, E1)).toMatchObject({ status: 'signed', signedAt: '2026-11-01T09:10:00Z' });
  });
});

describe('mergeServer', () => {
  const server = fromServer(serverRow({ errors_of_course: 1 }), [
    { sheet_id: 'sheet-1', movement_id: 'm1', mark: 7.5, comment: 'Judge edit', client_updated_at: t(5).toISOString() },
  ]);

  it('takes the server copy when the device has nothing unsent', () => {
    const local = { ...emptySheet(CJ, E1), version: 3, syncedVersion: 3 };
    const merged = mergeServer(local, server);
    expect(merged.marks.m1.mark).toBe(7.5);
    expect(merged.errorsOfCourse).toBe(1);
    expect(needsUpload(merged)).toBe(false);
  });

  it('keeps unsent device edits', () => {
    const local = applyEdit(emptySheet(CJ, E1), { type: 'mark', movementId: 'm1', mark: 5 }, t(2));
    const merged = mergeServer(local, server);
    expect(merged.marks.m1.mark).toBe(5);
    expect(merged.serverId).toBe('sheet-1');
    expect(needsUpload(merged)).toBe(true);
  });

  it('reads numeric strings from the server as numbers', () => {
    const s = fromServer(serverRow({ other_deductions: '2' as unknown as number }), [
      { sheet_id: 'sheet-1', movement_id: 'm1', mark: '6.5' as unknown as number, comment: null, client_updated_at: null },
    ]);
    expect(s.otherDeductions).toBe(2);
    expect(s.marks.m1.mark).toBe(6.5);
    expect(toPayload(s).marks[0].mark).toBe(6.5);
  });
});
