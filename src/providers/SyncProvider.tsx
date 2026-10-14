import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import type { LocalSheet, SheetEdit } from '@/lib/offline/sheets';
import { SheetStore } from '@/lib/offline/store';
import { syncSheets } from '@/lib/offline/sync';
import { saveSheet } from '@/lib/scoringApi';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

type SyncState = {
  store: SheetStore | null;
  /** Sheets with edits not yet on the server. */
  pending: number;
  /** Sheets the server refused. */
  rejected: number;
  /** The last upload attempt could not reach the server. */
  offline: boolean;
  lastSyncedAt: Date | null;
  syncNow: () => Promise<void>;
};

const SyncContext = createContext<SyncState | null>(null);

const RETRY_MS = 15_000;
const AFTER_EDIT_MS = 800;

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [store, setStore] = useState<SheetStore | null>(null);
  const [counts, setCounts] = useState({ pending: 0, rejected: 0 });
  const [offline, setOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One store per signed-in person, so a shared tablet never mixes sheets.
  useEffect(() => {
    if (!userId) {
      setStore(null);
      return;
    }
    let active = true;
    const next = new SheetStore(AsyncStorage, `eq.sheets.v1.${userId}`);
    next.load().then(() => active && setStore(next));
    return () => {
      active = false;
    };
  }, [userId]);

  const syncNow = useCallback(async () => {
    if (!store) return;
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        again.current = false;
        const result = await syncSheets(store, (payload) => saveSheet(supabase, payload));
        setOffline(result.offline);
        if (!result.offline) setLastSyncedAt(new Date());
      } while (again.current);
    } finally {
      running.current = false;
    }
  }, [store]);

  useEffect(() => {
    if (!store) return;
    const update = () => {
      setCounts({ pending: store.pending().length, rejected: store.rejected().length });
      if (editTimer.current) clearTimeout(editTimer.current);
      if (store.pending().length > 0) editTimer.current = setTimeout(syncNow, AFTER_EDIT_MS);
    };
    update();
    const unsubscribe = store.subscribe(update);
    const interval = setInterval(() => {
      if (store.pending().length > 0) syncNow();
    }, RETRY_MS);
    const appState = AppState.addEventListener('change', (s) => s === 'active' && syncNow());
    return () => {
      unsubscribe();
      clearInterval(interval);
      appState.remove();
      if (editTimer.current) clearTimeout(editTimer.current);
    };
  }, [store, syncNow]);

  return (
    <SyncContext.Provider value={{ store, ...counts, offline, lastSyncedAt, syncNow }}>{children}</SyncContext.Provider>
  );
}

export function useSync(): SyncState {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}

const noop = () => () => {};

/** The device's copy of one sheet, updating as it is edited or synced. */
export function useLocalSheet(classJudgeId: string, entryId: string) {
  const { store } = useSync();
  const subscribe = useCallback((cb: () => void) => (store ? store.subscribe(cb) : noop()), [store]);
  const sheet = useSyncExternalStore(subscribe, () => store?.get(classJudgeId, entryId));
  const edit = useCallback(
    (e: SheetEdit) => {
      store?.edit(classJudgeId, entryId, e);
    },
    [store, classJudgeId, entryId],
  );
  return { sheet: sheet as LocalSheet | undefined, edit, ready: store !== null };
}

/** Every sheet on the device for one judge's panel, keyed by entry id. */
export function usePanelSheets(classJudgeId: string): Record<string, LocalSheet> {
  const { store } = useSync();
  const [sheets, setSheets] = useState<Record<string, LocalSheet>>({});
  useEffect(() => {
    if (!store) return;
    const read = () =>
      setSheets(
        Object.fromEntries(store.all().filter((s) => s.classJudgeId === classJudgeId).map((s) => [s.entryId, s])),
      );
    read();
    return store.subscribe(read);
  }, [store, classJudgeId]);
  return sheets;
}
