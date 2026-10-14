import { toPayload, type SheetPayload } from './sheets';
import type { SheetStore } from './store';
import type { ScoreSheet } from '../types';

export type SaveResult =
  | { ok: true; sheet: ScoreSheet }
  /** transient: no signal, server busy, expired login. Kept and retried later. */
  | { ok: false; transient: boolean; message: string };

export type SyncOutcome = { uploaded: number; rejected: number; offline: boolean };

/**
 * Uploads every sheet with unsent edits, one at a time. Stops at the first
 * connection problem (the rest will fail the same way) and leaves those
 * sheets queued. Edits made while an upload is in flight stay queued too.
 */
export async function syncSheets(
  store: SheetStore,
  save: (payload: SheetPayload) => Promise<SaveResult>,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { uploaded: 0, rejected: 0, offline: false };

  for (const queued of store.pending()) {
    const sentVersion = queued.version;
    const result = await save(toPayload(queued));
    const latest = store.get(queued.classJudgeId, queued.entryId) ?? queued;

    if (result.ok) {
      const untouched = latest.version === sentVersion;
      store.put({
        ...latest,
        serverId: result.sheet.id,
        syncedVersion: Math.max(latest.syncedVersion, sentVersion),
        signedAt: result.sheet.signed_at,
        // The server may have moved the status on (an organiser reopened it).
        status: untouched ? result.sheet.status : latest.status,
        rejected: null,
      });
      outcome.uploaded += 1;
    } else if (result.transient) {
      outcome.offline = true;
      break;
    } else {
      store.put({ ...latest, rejected: { version: sentVersion, message: result.message } });
      outcome.rejected += 1;
    }
  }

  await store.flush();
  return outcome;
}
