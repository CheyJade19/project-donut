import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Card, ErrorText, Muted, Row, Screen, colors } from '@/components/ui';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { formatDate, formatTime } from '@/lib/format';
import { ordinal, resultsArePublic, sharedPlaces, type LeaderboardRow, type ResultClass } from '@/lib/results';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

/** A class's leaderboard, updating live as the judges sign sheets. */
export default function Leaderboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const { rows, error, updatedAt } = useLeaderboard(id);
  const [cls, setCls] = useState<ResultClass | null>(null);
  const [canSeeAllSheets, setCanSeeAllSheets] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 700;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('classes')
        .select('*, shows!inner(*), arenas(name), test_templates(name, code), class_judges(judge_id, scribe_id)')
        .eq('id', id)
        .single();
      if (!data) return;
      const row = data as ResultClass & { class_judges: { judge_id: string; scribe_id: string | null }[] };
      setCls(row);
      const onPanel = row.class_judges.some((j) => j.judge_id === userId || j.scribe_id === userId);
      const { data: org } = await supabase
        .from('club_members')
        .select('role')
        .eq('club_id', row.shows.club_id)
        .eq('user_id', userId ?? '')
        .eq('role', 'organiser');
      setCanSeeAllSheets(onPanel || (org ?? []).length > 0);
    })();
  }, [id, userId]);

  const shared = sharedPlaces(rows ?? []);
  const judges = rows?.[0]?.judges ?? [];
  const published = cls ? resultsArePublic(cls) : false;
  const allFinal = (rows ?? []).filter((r) => !r.withdrawn).every((r) => r.is_final || r.eliminated);

  function canOpen(r: LeaderboardRow) {
    return canSeeAllSheets || (published && r.rider_id != null && r.rider_id === userId);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: cls?.name ?? 'Leaderboard' }} />
      {cls && (
        <View style={{ gap: 2 }}>
          <Text style={styles.title}>{cls.name}</Text>
          <Muted>
            {[cls.shows.name, formatDate(cls.shows.show_date), cls.arenas?.name, cls.test_templates.code || cls.test_templates.name]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </View>
      )}
      <Row>
        <View style={[styles.pill, { backgroundColor: published && allFinal ? colors.primary : colors.danger }]}>
          <Text style={styles.pillText}>{published && allFinal ? 'FINAL' : '● LIVE'}</Text>
        </View>
        <Muted>
          {judges.length > 1 ? `${judges.length} judges, averaged. ` : ''}
          {updatedAt ? `Updated ${formatTime(updatedAt.toISOString())}` : 'Loading…'}
        </Muted>
      </Row>
      <ErrorText>{error}</ErrorText>
      {rows && rows.length === 0 && !error && <Muted>This leaderboard is not open yet.</Muted>}

      {wide && rows && rows.length > 0 && (
        <View style={styles.headRow}>
          <Text style={[styles.headCell, { width: 52 }]}>Place</Text>
          <Text style={[styles.headCell, { flex: 1 }]}>Rider and horse</Text>
          {judges.map((j) => (
            <Text key={j.class_judge_id} style={[styles.headCell, styles.judgeCol]}>
              {j.position}
            </Text>
          ))}
          <Text style={[styles.headCell, { width: 96, textAlign: 'right' }]}>Score</Text>
        </View>
      )}

      {(rows ?? []).map((r) => (
        <Card
          key={r.entry_id}
          onPress={canOpen(r) ? () => router.push({ pathname: '/results/entry/[id]', params: { id: r.entry_id } }) : undefined}
        >
          <View style={styles.row}>
            <Place row={r} shared={r.place != null && shared.has(r.place)} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.name, r.withdrawn && styles.withdrawn]}>{r.rider_name}</Text>
              <Muted>
                {[r.horse_name, r.draw_order != null && `Draw ${r.draw_order}`].filter(Boolean).join(' · ')}
              </Muted>
              {!wide && r.judges_signed > 0 && judges.length > 1 && (
                <Muted>
                  {r.judges.map((j) => `${j.position} ${j.percentage == null ? '–' : `${j.percentage.toFixed(2)}%`}`).join('   ')}
                </Muted>
              )}
              {!r.is_final && r.judges_signed > 0 && !r.eliminated && (
                <Text style={styles.provisional}>
                  Provisional: {r.judges_signed} of {r.judges_total} judges signed
                </Text>
              )}
            </View>
            {wide &&
              r.judges.map((j) => (
                <Text key={j.class_judge_id} style={[styles.judgeCol, styles.judgeScore]}>
                  {j.percentage == null ? (j.eliminated ? 'E' : '–') : `${j.percentage.toFixed(3)}`}
                </Text>
              ))}
            <View style={styles.scoreCol}>
              <Text style={styles.score}>
                {r.withdrawn ? 'WD' : r.eliminated ? 'Elim' : r.average_percentage == null ? '–' : `${r.average_percentage.toFixed(3)}%`}
              </Text>
              {r.total_points != null && !r.eliminated && <Muted>{r.total_points} pts</Muted>}
            </View>
          </View>
        </Card>
      ))}
      {rows && rows.length > 0 && (
        <Muted>
          Placings use the average of the judges' percentages from signed sheets. Equal scores are split on the collective
          marks, then share the placing.
        </Muted>
      )}
    </Screen>
  );
}

function Place({ row, shared }: { row: LeaderboardRow; shared: boolean }) {
  if (row.place == null) {
    const label = row.withdrawn ? 'WD' : row.eliminated ? 'E' : '…';
    return (
      <View style={[styles.place, { backgroundColor: colors.bg }]}>
        <Text style={[styles.placeText, { color: colors.muted }]}>{label}</Text>
      </View>
    );
  }
  const podium = row.place <= 3;
  return (
    <View style={[styles.place, { backgroundColor: row.place === 1 ? colors.accent : podium ? colors.primary : colors.bg }]}>
      <Text style={[styles.placeText, { color: podium ? colors.primaryText : colors.text }]}>{ordinal(row.place, shared)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  pill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: colors.primaryText, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 17 },
  headCell: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  place: { width: 52, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  placeText: { fontSize: 16, fontWeight: '800' },
  name: { fontSize: 17, fontWeight: '600' },
  withdrawn: { color: colors.muted, textDecorationLine: 'line-through' },
  provisional: { fontSize: 13, color: colors.danger },
  judgeCol: { width: 64, textAlign: 'center' },
  judgeScore: { fontSize: 15, color: colors.text },
  scoreCol: { width: 96, alignItems: 'flex-end' },
  score: { fontSize: 19, fontWeight: '800', color: colors.primary },
});
