import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Button, Card, ErrorText, Field, Muted, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { TestTemplate } from '@/lib/types';

type Row = TestTemplate & { test_movements: { count: number }[]; clubs: { name: string } | null };

export default function TestLibrary() {
  const [tests, setTests] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      supabase
        .from('test_templates')
        .select('*, test_movements(count), clubs(name)')
        .order('level', { ascending: true, nullsFirst: false })
        .order('name')
        .then(({ data, error }) => {
          if (!active) return;
          setLoading(false);
          if (error) setError(error.message);
          else setTests((data ?? []) as Row[]);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const q = query.trim().toLowerCase();
  const shown = q
    ? tests.filter((t) => [t.name, t.code, t.level].some((v) => v?.toLowerCase().includes(q)))
    : tests;

  return (
    <Screen>
      <Button label="Add a test" onPress={() => router.push('/tests/edit')} />
      <Field label="Search" value={query} onChangeText={setQuery} placeholder="Name, code or level" />
      <ErrorText>{error}</ErrorText>
      {!loading && shown.length === 0 && (
        <Muted>{tests.length === 0 ? 'No tests yet. Add one or upload a CSV.' : 'No tests match your search.'}</Muted>
      )}
      {shown.map((t) => (
        <Card key={t.id} onPress={() => router.push({ pathname: '/tests/[id]', params: { id: t.id } })}>
          <Text style={{ fontSize: 17, fontWeight: '600' }}>
            {t.code ? `${t.code} · ` : ''}
            {t.name}
          </Text>
          <Muted>
            {[t.level, t.arena_size, `${t.test_movements[0]?.count ?? 0} movements`, t.clubs?.name ?? 'Personal']
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </Card>
      ))}
    </Screen>
  );
}
