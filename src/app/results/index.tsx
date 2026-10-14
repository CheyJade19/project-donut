import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card, ErrorText, Muted, Screen, Title, colors } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { fetchMyResults, fetchResultClasses, ordinal, resultsArePublic, type MyResult, type ResultClass } from '@/lib/results';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

/** My placings, and the scoreboards that are open to everyone. */
export default function Results() {
  const { hasRole } = useAuth();
  const [mine, setMine] = useState<MyResult[] | null>(null);
  const [classes, setClasses] = useState<ResultClass[] | null>(null);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      Promise.all([fetchMyResults(supabase), fetchResultClasses(supabase)])
        .then(([m, c]) => {
          setMine(m);
          setClasses(c);
          setError('');
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, []),
  );

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {(hasRole('rider') || (mine?.length ?? 0) > 0) && (
        <>
          <Title>My results</Title>
          {mine?.length === 0 && <Muted>Your marks and the judges' comments appear here once a class's results are published.</Muted>}
          {mine?.map((r) => (
            <Card key={r.entry_id} onPress={() => router.push({ pathname: '/results/entry/[id]', params: { id: r.entry_id } })}>
              <View style={styles.row}>
                <View style={[styles.place, r.place === 1 && { backgroundColor: colors.accent }]}>
                  <Text style={styles.placeText}>{r.place != null ? ordinal(r.place) : r.eliminated ? 'E' : '–'}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.name}>
                    {r.cls.name} · {r.entry.horse_name}
                  </Text>
                  <Muted>
                    {[r.cls.shows.name, formatDate(r.cls.shows.show_date), r.place != null && `of ${r.placed_count}`, !r.is_final && 'Provisional']
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                </View>
                <Text style={styles.score}>
                  {r.eliminated ? 'Elim' : r.average_percentage == null ? '–' : `${r.average_percentage.toFixed(3)}%`}
                </Text>
              </View>
            </Card>
          ))}
        </>
      )}

      <Title>Scoreboards</Title>
      {classes?.length === 0 && <Muted>No live scoreboards or published results right now.</Muted>}
      {classes?.map((c) => {
        const final = resultsArePublic(c);
        return (
          <Card key={c.id} onPress={() => router.push({ pathname: '/results/class/[id]', params: { id: c.id } })}>
            <View style={styles.row}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name}>{c.name}</Text>
                <Muted>
                  {[c.shows.name, formatDate(c.shows.show_date), c.arenas?.name, c.test_templates.code || c.test_templates.name]
                    .filter(Boolean)
                    .join(' · ')}
                </Muted>
              </View>
              <View style={[styles.pill, { backgroundColor: final ? colors.primary : colors.danger }]}>
                <Text style={styles.pillText}>{final ? 'RESULTS' : '● LIVE'}</Text>
              </View>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  place: { width: 52, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  placeText: { fontSize: 16, fontWeight: '800', color: colors.primaryText },
  name: { fontSize: 17, fontWeight: '600' },
  score: { fontSize: 18, fontWeight: '800', color: colors.primary },
  pill: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { color: colors.primaryText, fontWeight: '700', fontSize: 12, letterSpacing: 0.5 },
});
