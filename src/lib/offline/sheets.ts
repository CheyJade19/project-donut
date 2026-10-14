import type { MovementScore, ScoreSheet, SheetStatus } from '../types';

/**
 * A score sheet as the device holds it. Every edit is saved on the device
 * first and bumps `version`; the sync engine uploads sheets whose version is
 * ahead of `syncedVersion`. Times are when the edit happened on the device,
 * so the server can keep the newest edit when two devices touch one sheet.
 */
export type LocalMark = { mark: number | null; comment: string | null; editedAt: string };

export type LocalSheet = {
  classJudgeId: string;
  entryId: string;
  serverId: string | null;
  status: SheetStatus;
  /** Keyed by movement id. */
  marks: Record<string, LocalMark>;
  errorsOfCourse: number;
  otherDeductions: number;
  eliminated: boolean;
  generalComment: string | null;
  editedAt: string;
  signedAt: string | null;
  version: number;
  syncedVersion: number;
  /** The server refused this version (for example the sheet was already signed). */
  rejected: { version: number; message: string } | null;
};

export type SheetEdit =
  | { type: 'mark'; movementId: string; mark: number | null }
  | { type: 'comment'; movementId: string; comment: string | null }
  | { type: 'errorsOfCourse'; value: number }
  | { type: 'otherDeductions'; value: number }
  | { type: 'eliminated'; value: boolean }
  | { type: 'generalComment'; value: string | null }
  | { type: 'status'; value: SheetStatus };

/** What save_score_sheet() expects. */
export type SheetPayload = {
  entry_id: string;
  class_judge_id: string;
  status: SheetStatus;
  errors_of_course: number;
  other_deductions: number;
  eliminated: boolean;
  general_comment: string | null;
  client_updated_at: string;
  marks: { movement_id: string; mark: number | null; comment: string | null; client_updated_at: string }[];
};

export const sheetKey = (classJudgeId: string, entryId: string) => `${classJudgeId}:${entryId}`;

export function emptySheet(classJudgeId: string, entryId: string, now = new Date()): LocalSheet {
  return {
    classJudgeId,
    entryId,
    serverId: null,
    status: 'draft',
    marks: {},
    errorsOfCourse: 0,
    otherDeductions: 0,
    eliminated: false,
    generalComment: null,
    editedAt: now.toISOString(),
    signedAt: null,
    version: 0,
    syncedVersion: 0,
    rejected: null,
  };
}

/**
 * Applies one edit. A signed sheet is locked on the device too; the only
 * change allowed is none at all, so the same sheet is returned.
 */
export function applyEdit(sheet: LocalSheet, edit: SheetEdit, now = new Date()): LocalSheet {
  if (sheet.status === 'signed') return sheet;
  const at = now.toISOString();
  const next: LocalSheet = { ...sheet, version: sheet.version + 1 };

  switch (edit.type) {
    case 'mark':
    case 'comment': {
      const prev = sheet.marks[edit.movementId] ?? { mark: null, comment: null, editedAt: at };
      const mark =
        edit.type === 'mark'
          ? { ...prev, mark: edit.mark, editedAt: at }
          : { ...prev, comment: edit.comment?.trim() ? edit.comment : null, editedAt: at };
      next.marks = { ...sheet.marks, [edit.movementId]: mark };
      return next;
    }
    case 'errorsOfCourse':
      return { ...next, errorsOfCourse: Math.max(0, Math.floor(edit.value)), editedAt: at };
    case 'otherDeductions':
      return { ...next, otherDeductions: Math.max(0, edit.value), editedAt: at };
    case 'eliminated':
      return { ...next, eliminated: edit.value, editedAt: at };
    case 'generalComment':
      return { ...next, generalComment: edit.value?.trim() ? edit.value : null, editedAt: at };
    case 'status':
      return { ...next, status: edit.value, editedAt: at };
  }
}

export function needsUpload(sheet: LocalSheet): boolean {
  if (sheet.version <= sheet.syncedVersion) return false;
  return !(sheet.rejected && sheet.rejected.version === sheet.version);
}

export function toPayload(sheet: LocalSheet): SheetPayload {
  return {
    entry_id: sheet.entryId,
    class_judge_id: sheet.classJudgeId,
    status: sheet.status,
    errors_of_course: sheet.errorsOfCourse,
    other_deductions: sheet.otherDeductions,
    eliminated: sheet.eliminated,
    general_comment: sheet.generalComment,
    client_updated_at: sheet.editedAt,
    marks: Object.entries(sheet.marks).map(([movementId, m]) => ({
      movement_id: movementId,
      mark: m.mark,
      comment: m.comment,
      client_updated_at: m.editedAt,
    })),
  };
}

/** A sheet built from what the server holds. */
export function fromServer(server: ScoreSheet, marks: MovementScore[]): LocalSheet {
  const fallback = server.client_updated_at ?? new Date(0).toISOString();
  return {
    classJudgeId: server.class_judge_id,
    entryId: server.entry_id,
    serverId: server.id,
    status: server.status,
    marks: Object.fromEntries(
      marks.map((m) => [
        m.movement_id,
        { mark: m.mark == null ? null : Number(m.mark), comment: m.comment, editedAt: m.client_updated_at ?? fallback },
      ]),
    ),
    errorsOfCourse: server.errors_of_course,
    otherDeductions: Number(server.other_deductions),
    eliminated: server.eliminated,
    generalComment: server.general_comment,
    editedAt: fallback,
    signedAt: server.signed_at,
    version: 0,
    syncedVersion: 0,
    rejected: null,
  };
}

/**
 * Combines a freshly downloaded sheet with the device's copy. Unsent edits on
 * the device win (they will be uploaded, and the server keeps whichever edit
 * is newer per mark); otherwise the server's copy replaces the device's.
 */
export function mergeServer(local: LocalSheet | undefined, server: LocalSheet): LocalSheet {
  if (!local) return server;
  if (needsUpload(local)) return { ...local, serverId: server.serverId ?? local.serverId };
  return { ...server, version: local.version, syncedVersion: local.version };
}
