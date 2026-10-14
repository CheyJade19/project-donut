import * as DocumentPicker from 'expo-document-picker';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PersonPicker, type PersonOption } from '@/components/PersonPicker';
import { Button, Card, Chip, ErrorText, Field, Muted, Row, Screen, Title, colors } from '@/components/ui';
import { parseEntriesCsv, type EntryDraft } from '@/lib/entryImport';
import { combineDateTime, formatTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import {
  JUDGE_POSITIONS,
  type ClassJudge,
  type DressageClass,
  type Entry,
  type JudgePosition,
  type SheetStatus,
  type Show,
  type TestTemplate,
} from '@/lib/types';

type ClassRow = DressageClass & { shows: Show; test_templates: TestTemplate; arenas: { name: string } | null };
type PanelRow = ClassJudge & { judge: { full_name: string } | null; scribe: { full_name: string } | null };

/** One class: judges and scribes, the draw, scoring progress and publishing. */
export default function ClassSetup() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [panel, setPanel] = useState<PanelRow[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sheets, setSheets] = useState<{ class_judge_id: string; entry_id: string; status: SheetStatus }[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [c, p, e] = await Promise.all([
      supabase.from('classes').select('*, shows(*), test_templates(*), arenas(name)').eq('id', id).single(),
      supabase
        .from('class_judges')
        .select('*, judge:profiles!class_judges_judge_id_fkey(full_name), scribe:profiles!class_judges_scribe_id_fkey(full_name)')
        .eq('class_id', id)
        .order('position'),
      supabase.from('entries').select('*').eq('class_id', id).order('draw_order', { nullsFirst: false }).order('rider_name'),
    ]);
    const failed = c.error ?? p.error ?? e.error;
    if (failed) setError(failed.message);
    const panelRows = (p.data ?? []) as PanelRow[];
    setCls(c.data as ClassRow | null);
    setPanel(panelRows);
    setEntries((e.data ?? []) as Entry[]);
    if (panelRows.length > 0) {
      const s = await supabase
        .from('score_sheets')
        .select('class_judge_id, entry_id, status')
        .in('class_judge_id', panelRows.map((r) => r.id));
      setSheets((s.data ?? []) as typeof sheets);
    } else setSheets([]);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function togglePublished() {
    if (!cls) return;
    const { error } = await supabase.from('classes').update({ results_published: !cls.results_published }).eq('id', id);
    if (error) setError(error.message);
    else load();
  }

  if (!cls) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</Screen>;

  const riders = entries.filter((e) => !e.withdrawn);
  const signed = sheets.filter((s) => s.status === 'signed').length;
  const needed = riders.length * panel.length;

  return (
    <Screen>
      <Stack.Screen options={{ title: cls.name }} />
      <Title>{cls.name}</Title>
      <Muted>
        {[cls.shows.name, cls.start_time && formatTime(cls.start_time), cls.arenas?.name, cls.test_templates.code || cls.test_templates.name]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
      <ErrorText>{error}</ErrorText>

      <Card>
        <Text style={styles.heading}>Scoring</Text>
        <Muted>
          {needed === 0
            ? 'Add judges and riders to start scoring.'
            : `${signed} of ${needed} sheets signed (${riders.length} riders × ${panel.length} judge${panel.length === 1 ? '' : 's'}).`}
        </Muted>
        <Row>
          <Chip label={cls.results_published ? 'Results published' : 'Results hidden'} selected={cls.results_published} onPress={togglePublished} />
          <Muted>{cls.results_published ? 'Riders can see their sheets.' : 'Riders see nothing until you publish.'}</Muted>
        </Row>
      </Card>

      <PanelCard classId={id} panel={panel} entries={riders} sheets={sheets} onChanged={load} />
      <EntriesCard cls={cls} entries={entries} onChanged={load} />
    </Screen>
  );
}

function PanelCard({
  classId,
  panel,
  entries,
  sheets,
  onChanged,
}: {
  classId: string;
  panel: PanelRow[];
  entries: Entry[];
  sheets: { class_judge_id: string; status: SheetStatus }[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [position, setPosition] = useState<JudgePosition>('C');
  const [judge, setJudge] = useState<PersonOption | null>(null);
  const [scribe, setScribe] = useState<PersonOption | null>(null);
  const [error, setError] = useState('');

  const free = JUDGE_POSITIONS.filter((p) => !panel.some((j) => j.position === p));

  async function add() {
    const { error } = await supabase
      .from('class_judges')
      .insert({ class_id: classId, position, judge_id: judge!.id, scribe_id: scribe?.id ?? null });
    if (error) return setError(error.message.includes('duplicate') ? 'That judge or position is already on this class.' : error.message);
    setAdding(false);
    setJudge(null);
    setScribe(null);
    setError('');
    onChanged();
  }

  async function remove(row: PanelRow) {
    const { error } = await supabase.from('class_judges').delete().eq('id', row.id);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <Card>
      <Text style={styles.heading}>Judges and scribes</Text>
      {panel.length === 0 && <Muted>No judges yet.</Muted>}
      {panel.map((row) => {
        const mine = sheets.filter((s) => s.class_judge_id === row.id);
        const hasSheets = mine.length > 0;
        return (
          <View key={row.id} style={styles.line}>
            <Text style={styles.position}>{row.position}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16 }}>{row.judge?.full_name ?? 'Judge'}</Text>
              <Muted>
                {row.scribe ? `Scribe: ${row.scribe.full_name}` : 'No scribe (the judge scores on their own device)'}
                {entries.length > 0 && ` · ${mine.filter((s) => s.status === 'signed').length}/${entries.length} signed`}
              </Muted>
            </View>
            {!hasSheets && (
              <Pressable accessibilityRole="button" onPress={() => remove(row)}>
                <Text style={{ color: colors.danger }}>Remove</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      {adding ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Muted>Position</Muted>
          <Row>
            {free.map((p) => (
              <Chip key={p} label={p} selected={position === p} onPress={() => setPosition(p)} />
            ))}
          </Row>
          <PersonPicker label="Judge" role="judge" selected={judge} onSelect={setJudge} />
          <PersonPicker label="Scribe (optional)" role="scribe" selected={scribe} onSelect={setScribe} />
          <ErrorText>{error}</ErrorText>
          <Row>
            <Button label="Add to panel" onPress={add} disabled={!judge || !free.includes(position)} />
            <Button label="Cancel" variant="secondary" onPress={() => setAdding(false)} />
          </Row>
        </View>
      ) : (
        <>
          <ErrorText>{error}</ErrorText>
          {free.length > 0 && (
            <Button
              label="Add a judge"
              variant="secondary"
              onPress={() => {
                setPosition(free[0]);
                setAdding(true);
              }}
            />
          )}
        </>
      )}
    </Card>
  );
}

function EntriesCard({ cls, entries, onChanged }: { cls: ClassRow; entries: Entry[]; onChanged: () => void }) {
  const [rider, setRider] = useState('');
  const [horse, setHorse] = useState('');
  const [time, setTime] = useState('');
  const [account, setAccount] = useState<PersonOption | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const nextDraw = Math.max(0, ...entries.map((e) => e.draw_order ?? 0)) + 1;

  async function addOne() {
    const start = time.trim() ? combineDateTime(cls.shows.show_date, time) : null;
    if (time.trim() && !start) return setError('Enter the ride time like 09:30.');
    const { error } = await supabase.from('entries').insert({
      class_id: cls.id,
      rider_name: rider.trim(),
      horse_name: horse.trim(),
      rider_id: account?.id ?? null,
      draw_order: nextDraw,
      start_time: start,
    });
    if (error) return setError(error.message);
    setRider('');
    setHorse('');
    setTime('');
    setAccount(null);
    setError('');
    onChanged();
  }

  async function importDraw(text: string) {
    const { entries: drafts, errors } = parseEntriesCsv(text, cls.shows.show_date);
    setNotes(errors);
    if (drafts.length === 0) return;
    setBusy(true);
    const linked = await linkRiderAccounts(drafts);
    const { error } = await supabase.from('entries').insert(linked.map((d) => ({ ...d, class_id: cls.id })));
    setBusy(false);
    if (error) return setError(error.message);
    setCsvOpen(false);
    setCsvText('');
    setNotes([...errors, `Added ${drafts.length} rider${drafts.length === 1 ? '' : 's'}.`]);
    onChanged();
  }

  async function pickCsv() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    importDraw(await (await fetch(picked.assets[0].uri)).text());
  }

  async function setWithdrawn(entry: Entry, withdrawn: boolean) {
    const { error } = await supabase.from('entries').update({ withdrawn }).eq('id', entry.id);
    if (error) setError(error.message);
    else onChanged();
  }

  return (
    <Card>
      <Text style={styles.heading}>Riders ({entries.filter((e) => !e.withdrawn).length})</Text>
      {entries.map((e) => (
        <View key={e.id} style={styles.line}>
          <Text style={styles.position}>{e.draw_order ?? '–'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[{ fontSize: 16 }, e.withdrawn && { color: colors.muted, textDecorationLine: 'line-through' }]}>
              {e.rider_name} · {e.horse_name}
            </Text>
            <Muted>
              {[e.start_time && formatTime(e.start_time), e.rider_id ? 'Has an account' : null, e.withdrawn && 'Withdrawn']
                .filter(Boolean)
                .join(' · ') || ' '}
            </Muted>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setWithdrawn(e, !e.withdrawn)}>
            <Text style={{ color: e.withdrawn ? colors.primary : colors.danger }}>{e.withdrawn ? 'Reinstate' : 'Withdraw'}</Text>
          </Pressable>
        </View>
      ))}

      <View style={{ gap: 8, marginTop: 8 }}>
        <Text style={{ fontWeight: '600' }}>Add a rider (draw {nextDraw})</Text>
        <Row>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Field label="Rider" value={rider} onChangeText={setRider} />
          </View>
          <View style={{ flex: 1, minWidth: 160 }}>
            <Field label="Horse" value={horse} onChangeText={setHorse} />
          </View>
          <View style={{ width: 100 }}>
            <Field label="Time" value={time} onChangeText={setTime} placeholder="09:30" />
          </View>
        </Row>
        <PersonPicker label="Rider's account (optional, lets them see results)" role="rider" selected={account} onSelect={setAccount} />
        <Button label="Add rider" variant="secondary" onPress={addOne} disabled={!rider.trim() || !horse.trim()} />
      </View>

      <View style={{ gap: 8, marginTop: 8 }}>
        <Text style={{ fontWeight: '600' }}>Load the draw from a spreadsheet</Text>
        <Muted>A CSV with columns rider, horse, draw, time (time like 09:30). Riders whose name matches one account are linked to it.</Muted>
        <Row>
          <Button label="Upload CSV" variant="secondary" onPress={pickCsv} busy={busy} />
          <Button label={csvOpen ? 'Hide paste box' : 'Paste CSV'} variant="secondary" onPress={() => setCsvOpen(!csvOpen)} />
        </Row>
        {csvOpen && (
          <>
            <Field label="CSV" value={csvText} onChangeText={setCsvText} multiline placeholder={'rider,horse,draw,time\nRita Rider,Biscuit,1,09:00'} />
            <Button label="Import pasted CSV" onPress={() => importDraw(csvText)} disabled={!csvText.trim()} busy={busy} />
          </>
        )}
        {notes.map((n) => (
          <Muted key={n}>{n}</Muted>
        ))}
      </View>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

/** Links each imported rider to an account when exactly one has that name. */
async function linkRiderAccounts(drafts: EntryDraft[]) {
  const names = [...new Set(drafts.map((d) => d.rider_name))];
  const { data } = await supabase.from('profiles').select('id, full_name').in('full_name', names);
  const byName = new Map<string, string[]>();
  for (const p of (data ?? []) as { id: string; full_name: string }[]) {
    byName.set(p.full_name, [...(byName.get(p.full_name) ?? []), p.id]);
  }
  return drafts.map((d) => {
    const ids = byName.get(d.rider_name) ?? [];
    return { ...d, rider_id: ids.length === 1 ? ids[0] : null };
  });
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  position: { width: 28, fontSize: 18, fontWeight: '700', color: colors.primary, textAlign: 'center' },
});
