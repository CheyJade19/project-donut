import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { fetchLeaderboard, type LeaderboardRow } from '@/lib/results';
import { supabase } from '@/lib/supabase';

/** Reloads every 30 seconds too, in case the live connection drops. */
const POLL_MS = 30_000;

/**
 * A class's leaderboard, kept live: the database bumps the class row whenever
 * a sheet is signed, reopened or a rider withdraws, and this reloads on that
 * change (Supabase realtime), on a timer, and when the app comes back to the
 * foreground.
 */
export function useLeaderboard(classId: string) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await fetchLeaderboard(supabase, classId));
      setUpdatedAt(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [classId]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`leaderboard:${classId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'classes', filter: `id=eq.${classId}` }, () =>
        refresh(),
      )
      .subscribe();
    const timer = setInterval(refresh, POLL_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
      appState.remove();
    };
  }, [classId, refresh]);

  return { rows, error, updatedAt, refresh };
}
