import { applyEdit, emptySheet, mergeServer, needsUpload, sheetKey, type LocalSheet, type SheetEdit } from './sheets';

/** The subset of AsyncStorage the store needs (an in-memory map in tests). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

type Listener = () => void;

/**
 * Every score sheet on this device, kept in memory and written through to
 * storage after each change so nothing is lost if the app is closed.
 */
export class SheetStore {
  private sheets = new Map<string, LocalSheet>();
  private listeners = new Set<Listener>();
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private storage: KeyValueStorage,
    private storageKey: string,
  ) {}

  async load(): Promise<void> {
    const raw = await this.storage.getItem(this.storageKey);
    this.sheets.clear();
    if (!raw) return;
    try {
      for (const s of JSON.parse(raw) as LocalSheet[]) this.sheets.set(sheetKey(s.classJudgeId, s.entryId), s);
    } catch {
      // A corrupt blob should not stop scoring; start empty.
    }
  }

  get(classJudgeId: string, entryId: string): LocalSheet | undefined {
    return this.sheets.get(sheetKey(classJudgeId, entryId));
  }

  all(): LocalSheet[] {
    return [...this.sheets.values()];
  }

  pending(): LocalSheet[] {
    return this.all().filter(needsUpload);
  }

  rejected(): LocalSheet[] {
    return this.all().filter((s) => s.rejected && s.rejected.version === s.version);
  }

  edit(classJudgeId: string, entryId: string, edit: SheetEdit, now = new Date()): LocalSheet {
    const current = this.get(classJudgeId, entryId) ?? emptySheet(classJudgeId, entryId, now);
    const next = applyEdit(current, edit, now);
    if (next !== current) this.put(next);
    return next;
  }

  /** Merges sheets downloaded from the server, keeping unsent device edits. */
  mergeFromServer(serverSheets: LocalSheet[]): void {
    for (const s of serverSheets) {
      this.sheets.set(sheetKey(s.classJudgeId, s.entryId), mergeServer(this.get(s.classJudgeId, s.entryId), s));
    }
    this.changed();
  }

  put(sheet: LocalSheet): void {
    this.sheets.set(sheetKey(sheet.classJudgeId, sheet.entryId), sheet);
    this.changed();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once everything changed so far is in storage. */
  flush(): Promise<void> {
    return this.writing;
  }

  private changed() {
    const snapshot = JSON.stringify(this.all());
    // Writes are chained so an older snapshot can never land after a newer one.
    this.writing = this.writing.then(() => this.storage.setItem(this.storageKey, snapshot)).catch(() => {});
    for (const l of this.listeners) l();
  }
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    async getItem(key) {
      return key in data ? data[key] : null;
    },
    async setItem(key, value) {
      data[key] = value;
    },
  };
}
