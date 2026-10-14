import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, Card, ErrorText, Muted, Screen, Title, colors } from '@/components/ui';
import { maxTestPoints } from '@/lib/scoring';
import { supabase } from '@/lib/supabase';
import type { TestMovement, TestTemplate } from '@/lib/types';

export default function TestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [test, setTest] = useState<TestTemplate | null>(null);
  const [movements, setMovements] = useState<TestMovement[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [t, m, e] = await Promise.all([
          supabase.from('test_templates').select('*').eq('id', id).single(),
          supabase.from('test_movements').select('*').eq('test_id', id).order('number'),
          supabase.rpc('can_edit_test', { target_test: id }),
        ]);
        if (t.error || m.error) setError((t.error ?? m.error)!.message);
        setTest(t.data as TestTemplate | null);
        setMovements((m.data ?? []) as TestMovement[]);
        setCanEdit(e.data === true);
      })();
    }, [id]),
  );

  if (!test) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</Screen>;

  const technical = movements.filter((m) => !m.is_collective);
  const collective = movements.filter((m) => m.is_collective);

  return (
    <Screen>
      <Stack.Screen options={{ title: test.code || test.name }} />
      <Title>{test.name}</Title>
      <Muted>
        {[test.level, test.arena_size && `${test.arena_size} arena`, `Max ${maxTestPoints(movements)} points`]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
      <Muted>
        Errors of course: {test.error_penalties.map((p, i) => `error ${i + 1} −${p}`).join(', ')}, then elimination
      </Muted>
      {test.notes ? <Muted>{test.notes}</Muted> : null}
      {canEdit && <Button label="Edit test" variant="secondary" onPress={() => router.push({ pathname: '/tests/edit', params: { id: test.id } })} />}

      <MovementTable title="Movements" movements={technical} />
      {collective.length > 0 && <MovementTable title="Collective marks" movements={collective} />}
    </Screen>
  );
}

function MovementTable({ title, movements }: { title: string; movements: TestMovement[] }) {
  return (
    <Card>
      <Text style={styles.heading}>{title}</Text>
      {movements.map((m) => (
        <View key={m.id} style={styles.row}>
          <Text style={styles.num}>{m.number}</Text>
          <View style={{ flex: 1 }}>
            {m.markers ? <Text style={styles.markers}>{m.markers}</Text> : null}
            <Text>{m.description}</Text>
            {m.directive_ideas ? <Muted>{m.directive_ideas}</Muted> : null}
          </View>
          <Text style={styles.coef}>{m.coefficient > 1 ? `×${m.coefficient}` : ''}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  num: { width: 28, fontWeight: '700', color: colors.primary },
  markers: { fontWeight: '600' },
  coef: { width: 32, textAlign: 'right', fontWeight: '700', color: colors.accent },
});
