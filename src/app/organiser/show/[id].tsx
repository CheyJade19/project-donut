import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Card, Chip, ErrorText, Field, Muted, Row, Screen, Title, colors } from '@/components/ui';
import { combineDateTime, formatDate, formatTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import {
  SHOW_STATUS_LABELS,
  type Arena,
  type ArenaSize,
  type DressageClass,
  type Show,
  type ShowStatus,
  type TestTemplate,
} from '@/lib/types';

type ClassRow = DressageClass & {
  test_templates: Pick<TestTemplate, 'name' | 'code'> | null;
  entries: { count: number }[];
  class_judges: { count: number }[];
};

/** One show: its status, arenas and classes. */
export default function ShowSetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [show, setShow] = useState<Show | null>(null);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [s, a, c] = await Promise.all([
      supabase.from('shows').select('*').eq('id', id).single(),
      supabase.from('arenas').select('*').eq('show_id', id).order('name'),
      supabase
        .from('classes')
        .select('*, test_templates(name, code), entries(count), class_judges(count)')
        .eq('show_id', id)
        .order('start_time', { ascending: true, nullsFirst: false })
        .order('name'),
    ]);
    const failed = s.error ?? a.error ?? c.error;
    if (failed) setError(failed.message);
    setShow(s.data as Show | null);
    setArenas((a.data ?? []) as Arena[]);
    setClasses((c.data ?? []) as ClassRow[]);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function setStatus(status: ShowStatus) {
    const { error } = await supabase.from('shows').update({ status }).eq('id', id);
    if (error) setError(error.message);
    else load();
  }

  if (!show) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: show.name }} />
      <Title>{show.name}</Title>
      <Muted>{[formatDate(show.show_date), show.venue].filter(Boolean).join(' · ')}</Muted>
      <ErrorText>{error}</ErrorText>

      <Muted>Show status</Muted>
      <Row>
        {(Object.keys(SHOW_STATUS_LABELS) as ShowStatus[]).map((s) => (
          <Chip key={s} label={SHOW_STATUS_LABELS[s]} selected={show.status === s} onPress={() => setStatus(s)} />
        ))}
      </Row>

      <ArenasCard showId={show.id} arenas={arenas} onChanged={load} />

      <Title>Classes</Title>
      {classes.length === 0 && <Muted>No classes yet. Add one below.</Muted>}
      {classes.map((c) => (
        <Card key={c.id} onPress={() => router.push({ pathname: '/organiser/class/[id]', params: { id: c.id } })}>
          <Text style={{ fontSize: 17, fontWeight: '600' }}>{c.name}</Text>
          <Muted>
            {[
              c.start_time && formatTime(c.start_time),
              arenas.find((a) => a.id === c.arena_id)?.name,
              c.test_templates && (c.test_templates.code || c.test_templates.name),
              `${c.entries[0]?.count ?? 0} riders`,
              `${c.class_judges[0]?.count ?? 0} judges`,
              c.results_published && 'Results published',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </Card>
      ))}

      <NewClass show={show} arenas={arenas} onCreated={load} />
    </Screen>
  );
}

function ArenasCard({ showId, arenas, onChanged }: { showId: string; arenas: Arena[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [size, setSize] = useState<ArenaSize>('20x60');
  const [error, setError] = useState('');

  async function add() {
    const { error } = await supabase.from('arenas').insert({ show_id: showId, name: name.trim(), size });
    if (error) return setError(error.message);
    setName('');
    setError('');
    onChanged();
  }

  async function remove(id: string) {
    const { error } = await supabase.from('arenas').delete().eq('id', id);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <Card>
      <Text style={{ fontSize: 17, fontWeight: '700' }}>Arenas</Text>
      {arenas.map((a) => (
        <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
          <Text style={{ flex: 1, fontSize: 16 }}>
            {a.name}
            {a.size ? ` · ${a.size}` : ''}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => remove(a.id)}>
            <Text style={{ color: colors.danger }}>Remove</Text>
          </Pressable>
        </View>
      ))}
      <Field label="New arena" value={name} onChangeText={setName} placeholder="e.g. Arena 1" />
      <Row>
        {(['20x40', '20x60'] as ArenaSize[]).map((s) => (
          <Chip key={s} label={s} selected={size === s} onPress={() => setSize(s)} />
        ))}
        <Button label="Add arena" variant="secondary" onPress={add} disabled={!name.trim()} />
      </Row>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function NewClass({ show, arenas, onCreated }: { show: Show; arenas: Arena[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [arenaId, setArenaId] = useState<string | null>(null);
  const [time, setTime] = useState('');
  const [testQuery, setTestQuery] = useState('');
  const [tests, setTests] = useState<TestTemplate[]>([]);
  const [test, setTest] = useState<TestTemplate | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function openForm() {
    setOpen(true);
    const { data } = await supabase.from('test_templates').select('*').order('level').order('name');
    setTests((data ?? []) as TestTemplate[]);
  }

  async function create() {
    const start = time.trim() ? combineDateTime(show.show_date, time) : null;
    if (time.trim() && !start) return setError('Enter the start time like 09:30.');
    setBusy(true);
    setError('');
    const { data, error } = await supabase
      .from('classes')
      .insert({ show_id: show.id, name: name.trim(), arena_id: arenaId, test_id: test!.id, start_time: start })
      .select('id')
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setOpen(false);
    setName('');
    setTime('');
    setTest(null);
    onCreated();
    router.push({ pathname: '/organiser/class/[id]', params: { id: data.id as string } });
  }

  if (!open) return <Button label="Add a class" onPress={openForm} />;

  const q = testQuery.trim().toLowerCase();
  const shownTests = (q ? tests.filter((t) => [t.name, t.code, t.level].some((v) => v?.toLowerCase().includes(q))) : tests).slice(0, 12);

  return (
    <Card>
      <Text style={{ fontSize: 17, fontWeight: '700' }}>New class</Text>
      <Field label="Class name" value={name} onChangeText={setName} placeholder="e.g. Preliminary Open" />
      <Field label="Start time" value={time} onChangeText={setTime} placeholder="09:30" />
      {arenas.length > 0 && (
        <>
          <Muted>Arena</Muted>
          <Row>
            {arenas.map((a) => (
              <Chip key={a.id} label={a.name} selected={arenaId === a.id} onPress={() => setArenaId(arenaId === a.id ? null : a.id)} />
            ))}
          </Row>
        </>
      )}
      <Muted>Test</Muted>
      {test ? (
        <Row>
          <Text style={{ fontSize: 16 }}>{test.code ? `${test.code} · ` : ''}{test.name}</Text>
          <Pressable accessibilityRole="button" onPress={() => setTest(null)}>
            <Text style={{ color: colors.primary }}>Change</Text>
          </Pressable>
        </Row>
      ) : (
        <>
          <Field label="Find a test" value={testQuery} onChangeText={setTestQuery} placeholder="Name, code or level" />
          {tests.length === 0 && <Muted>The test library is empty. Add tests there first.</Muted>}
          <Row>
            {shownTests.map((t) => (
              <Chip key={t.id} label={t.code || t.name} selected={false} onPress={() => setTest(t)} />
            ))}
          </Row>
        </>
      )}
      <ErrorText>{error}</ErrorText>
      <Button label="Create class" onPress={create} busy={busy} disabled={!name.trim() || !test} />
      <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
    </Card>
  );
}
