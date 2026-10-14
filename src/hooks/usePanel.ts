import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { cacheBundle, cachedBundle, fetchBundle, type AssignmentBundle } from '@/lib/scoringApi';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useSync } from '@/providers/SyncProvider';

/**
 * One judge's panel: the copy saved on the device straight away, then a fresh
 * download when there is signal. Downloaded sheets are merged into the
 * device's sheets without losing unsent edits.
 */
export function usePanel(classJudgeId: string) {
  const { session } = useAuth();
  const { store } = useSync();
  const userId = session?.user.id;
  const [bundle, setBundle] = useState<AssignmentBundle | null>(null);
  const [error, setError] = useState('');
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId || !store) return;
    setLoading(true);
    try {
      const fresh = await fetchBundle(supabase, classJudgeId);
      store.mergeFromServer(fresh.sheets);
      await cacheBundle(AsyncStorage, userId, fresh);
      setBundle(fresh);
      setFromCache(false);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [classJudgeId, store, userId]);

  useEffect(() => {
    if (!userId || !store) return;
    let active = true;
    (async () => {
      const cached = await cachedBundle(AsyncStorage, userId, classJudgeId);
      if (!active) return;
      if (cached) {
        setBundle(cached);
        setFromCache(true);
      }
      refresh();
    })();
    return () => {
      active = false;
    };
  }, [classJudgeId, refresh, store, userId]);

  return { bundle, error, fromCache, loading, refresh };
}
