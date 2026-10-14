import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { SyncBadge } from '@/components/SyncBadge';
import { Card, ErrorText, Muted, Screen } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/format';
import { cacheAssignments, cachedAssignments, fetchMyAssignments, type Assignment } from '@/lib/scoringApi';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

/** Panels this person judges or scribes for, from today on. */
export default function MyPanels() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [list, setList] = useState<Assignment[] | null>(null);
  const [note, setNote] = useState('');

  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      let active = true;
      (async () => {
        const cached = await cachedAssignments(AsyncStorage, userId);
        if (active && cached) setList((current) => current ?? cached);
        try {
          const fresh = await fetchMyAssignments(supabase, userId);
          if (!active) return;
          setList(fresh);
          setNote('');
          await cacheAssignments(AsyncStorage, userId, fresh);
        } catch (e) {
          if (!active) return;
          setNote(cached ? 'No signal. Showing the classes saved on this device.' : (e as Error).message);
          if (!cached) setList([]);
        }
      })();
      return () => {
        active = false;
      };
    }, [userId]),
  );

  return (
    <Screen>
      <SyncBadge />
      <ErrorText>{note}</ErrorText>
      {list?.length === 0 && (
        <Muted>No classes yet. When an organiser puts you on a judging panel, it shows up here.</Muted>
      )}
      {list?.map((a) => {
        const asJudge = a.classJudge.judge_id === userId;
        return (
          <Card
            key={a.classJudge.id}
            onPress={() => router.push({ pathname: '/scoring/[panel]', params: { panel: a.classJudge.id } })}
          >
            <Text style={{ fontSize: 18, fontWeight: '600' }}>{a.cls.name}</Text>
            <Muted>
              {[a.show.name, formatDate(a.show.show_date), a.arena?.name, a.cls.start_time && formatTime(a.cls.start_time)]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
            <Muted>
              {a.test.code ? `${a.test.code} · ` : ''}
              {a.test.name} · Judge at {a.classJudge.position}
            </Muted>
            <Muted>
              {asJudge
                ? `You are judging${a.scribeName ? `, ${a.scribeName} is scribing` : ''}`
                : `You are scribing for ${a.judgeName}`}
            </Muted>
          </Card>
        );
      })}
    </Screen>
  );
}
