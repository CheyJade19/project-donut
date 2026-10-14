import * as DocumentPicker from 'expo-document-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Chip, ErrorText, Field, Muted, Row, Screen, colors } from '@/components/ui';
import { maxTestPoints } from '@/lib/scoring';
import { supabase } from '@/lib/supabase';
import { parseTestCsv } from '@/lib/testImport';
import type { ArenaSize, MovementDraft, TestTemplate } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

type Club = { id: string; name: string };

const blankMovement = (number: number): MovementDraft => ({
  number,
  markers: null,
  description: '',
  directive_ideas: null,
  coefficient: 1,
  max_mark: 10,
  is_collective: false,
});

export default function EditTest() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [level, setLevel] = useState('');
  const [arenaSize, setArenaSize] = useState<ArenaSize | null>(null);
  const [penalties, setPenalties] = useState('2, 4');
  const [notes, setNotes] = useState('');
  const [clubId, setClubId] = useState<string | null>(null);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [movements, setMovements] = useState<MovementDraft[]>([blankMovement(1)]);
  const [inUse, setInUse] = useState(false);

  const [csvText, setCsvText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    supabase
      .from('club_members')
      .select('clubs(id, name)')
      .eq('user_id', session.user.id)
      .eq('role', 'organiser')
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as { clubs: Club | null }[];
        setClubs(rows.map((r) => r.clubs).filter((c): c is Club => c !== null));
      });
  }, [session]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const [t, m, used] = await Promise.all([
        supabase.from('test_templates').select('*').eq('id', id).single(),
        supabase.from('test_movements').select('*').eq('test_id', id).order('number'),
        supabase.from('classes').select('id', { count: 'exact', head: true }).eq('test_id', id),
      ]);
      const test = t.data as TestTemplate | null;
      if (!test) return setError(t.error?.message ?? 'Test not found.');
      setName(test.name);
      setCode(test.code ?? '');
      setLevel(test.level ?? '');
      setArenaSize(test.arena_size);
      setPenalties(test.error_penalties.join(', '));
      setNotes(test.notes ?? '');
      setClubId(test.club_id);
      setMovements(((m.data ?? []) as MovementDraft[]).map(({ number, markers, description, directive_ideas, coefficient, max_mark, is_collective }) => ({
        number, markers, description, directive_ideas, coefficient, max_mark, is_collective,
      })));
      setInUse((used.count ?? 0) > 0);
    })();
  }, [id]);

  function applyCsv(text: string) {
    const result = parseTestCsv(text);
    setImportNotes(result.errors);
    if (result.movements.length > 0) {
      setMovements(result.movements);
      setShowPaste(false);
    }
  }

  async function pickCsv() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const text = await (await fetch(picked.assets[0].uri)).text();
    applyCsv(text);
  }

  function update(index: number, patch: Partial<MovementDraft>) {
    setMovements((list) => list.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  function remove(index: number) {
    setMovements((list) => list.filter((_, i) => i !== index).map((m, i) => ({ ...m, number: i + 1 })));
  }

  async function save() {
    setError('');
    const errorPenalties = penalties
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map(Number);
    if (errorPenalties.some((p) => !(p >= 0))) return setError('Error penalties must be numbers, like "2, 4".');
    const clean = movements.filter((m) => m.description.trim());
    if (clean.length === 0) return setError('Add at least one movement.');
    if (new Set(clean.map((m) => m.number)).size !== clean.length) return setError('Movement numbers must be unique.');

    setBusy(true);
    const fields = {
      name: name.trim(),
      code: code.trim() || null,
      level: level.trim() || null,
      arena_size: arenaSize,
      error_penalties: errorPenalties,
      notes: notes.trim() || null,
      club_id: clubId,
    };

    let testId = id;
    if (testId) {
      const { error } = await supabase.from('test_templates').update(fields).eq('id', testId);
      if (error) return fail(error.message);
    } else {
      const { data, error } = await supabase.from('test_templates').insert(fields).select('id').single();
      if (error) return fail(error.message);
      testId = data.id as string;
    }

    // Movements are replaced wholesale. Tests already used in a show are
    // locked (score sheets point at their movements).
    if (!inUse) {
      const del = await supabase.from('test_movements').delete().eq('test_id', testId);
      if (del.error) return fail(del.error.message);
      const ins = await supabase.from('test_movements').insert(
        clean.map((m) => ({ ...m, test_id: testId, description: m.description.trim() })),
      );
      if (ins.error) return fail(ins.error.message);
    }

    setBusy(false);
    router.replace({ pathname: '/tests/[id]', params: { id: testId! } });
  }

  function fail(message: string) {
    setBusy(false);
    setError(message);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit test' : 'New test' }} />
      <Field label="Test name" value={name} onChangeText={setName} placeholder="e.g. Preliminary 1" />
      <Row>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Code" value={code} onChangeText={setCode} placeholder="e.g. P1" />
        </View>
        <View style={{ flex: 1, minWidth: 140 }}>
          <Field label="Level" value={level} onChangeText={setLevel} placeholder="e.g. Preliminary" />
        </View>
      </Row>
      <Muted>Arena</Muted>
      <Row>
        {(['20x40', '20x60'] as ArenaSize[]).map((size) => (
          <Chip key={size} label={size} selected={arenaSize === size} onPress={() => setArenaSize(arenaSize === size ? null : size)} />
        ))}
      </Row>
      <Field
        label="Error of course penalties (1st, 2nd, …; one more eliminates)"
        value={penalties}
        onChangeText={setPenalties}
      />
      {clubs.length > 0 && (
        <>
          <Muted>Library</Muted>
          <Row>
            <Chip label="Personal" selected={clubId === null} onPress={() => setClubId(null)} />
            {clubs.map((c) => (
              <Chip key={c.id} label={c.name} selected={clubId === c.id} onPress={() => setClubId(c.id)} />
            ))}
          </Row>
        </>
      )}
      <Field label="Notes" value={notes} onChangeText={setNotes} multiline />

      <Card>
        <Text style={styles.heading}>Movements</Text>
        {inUse ? (
          <Muted>This test is already used in a show, so its movements are locked. Add a new test to make changes.</Muted>
        ) : (
          <>
            <Muted>Enter movements below, or upload a CSV (see docs/test-template.csv for the format).</Muted>
            <Row>
              <Button label="Upload CSV" variant="secondary" onPress={pickCsv} />
              <Button label={showPaste ? 'Hide paste box' : 'Paste CSV'} variant="secondary" onPress={() => setShowPaste(!showPaste)} />
            </Row>
            {showPaste && (
              <>
                <Field label="CSV" value={csvText} onChangeText={setCsvText} multiline placeholder="number,markers,movement,directives,coefficient,collective" />
                <Button label="Import pasted CSV" onPress={() => applyCsv(csvText)} disabled={!csvText.trim()} />
              </>
            )}
            {importNotes.map((n) => (
              <ErrorText key={n}>{n}</ErrorText>
            ))}
          </>
        )}
        <Muted>Maximum {maxTestPoints(movements.filter((m) => m.description.trim()))} points</Muted>
      </Card>

      {movements.map((m, i) => (
        <Card key={i}>
          <Row>
            <Text style={styles.num}>#{m.number}</Text>
            <Chip label="Collective mark" selected={m.is_collective} onPress={() => !inUse && update(i, { is_collective: !m.is_collective })} />
            <View style={{ flex: 1 }} />
            {!inUse && (
              <Pressable onPress={() => remove(i)} accessibilityRole="button">
                <Text style={{ color: colors.danger }}>Remove</Text>
              </Pressable>
            )}
          </Row>
          <Field label="Markers" value={m.markers ?? ''} editable={!inUse} onChangeText={(t) => update(i, { markers: t || null })} placeholder="e.g. A X C" />
          <Field label="Movement" value={m.description} editable={!inUse} onChangeText={(t) => update(i, { description: t })} multiline />
          <Field label="Directive ideas" value={m.directive_ideas ?? ''} editable={!inUse} onChangeText={(t) => update(i, { directive_ideas: t || null })} multiline />
          <Muted>Coefficient</Muted>
          <Row>
            {[1, 2, 3, 4, 5].map((c) => (
              <Chip key={c} label={`×${c}`} selected={m.coefficient === c} onPress={() => !inUse && update(i, { coefficient: c })} />
            ))}
          </Row>
        </Card>
      ))}
      {!inUse && (
        <Button
          label="Add movement"
          variant="secondary"
          onPress={() => setMovements((list) => [...list, blankMovement((list.at(-1)?.number ?? 0) + 1)])}
        />
      )}

      <ErrorText>{error}</ErrorText>
      <Button label="Save test" onPress={save} busy={busy} disabled={!name.trim()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700' },
  num: { fontSize: 17, fontWeight: '700', color: colors.primary },
});
