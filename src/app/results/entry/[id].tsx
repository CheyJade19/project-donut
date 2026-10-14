import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Button, Card, Chip, ErrorText, Muted, Row, Screen, Title, colors } from '@/components/ui';
import { formatDate, formatMark, formatPoints } from '@/lib/format';
import {
  fetchEntryResult,
  fetchLeaderboard,
  ordinal,
  sharedPlaces,
  type EntryResult,
  type JudgeSheet,
} from '@/lib/results';
import { shareScoreSheet } from '@/lib/sharePdf';
import { SHEET_STATUS_LABELS, type TestMovement } from '@/lib/types';
import { supabase } from '@/lib/supabase';

type Placing = { place: number | null; shared: boolean; of: number } | null;

/** One rider's result: every judge's marks and comments, and the PDF. */
export default function EntryResultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [result, setResult] = useState<EntryResult | null>(null);
  const [placing, setPlacing] = useState<Placing>(null);
  const [view, setView] = useState<string>('compare');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { width } = useWindowDimensions();

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchEntryResult(supabase, id);
        setResult(r);
        const visible = r.judges.filter((j) => j.sheet);
        setView(visible.length > 1 ? 'compare' : (visible[0]?.classJudge.id ?? 'compare'));
        const board = await fetchLeaderboard(supabase, r.cls.id).catch(() => []);
        const mine = board.find((b) => b.entry_id === id);
        if (mine) {
          setPlacing({
            place: mine.place,
            shared: mine.place != null && sharedPlaces(board).has(mine.place),
            of: board.filter((b) => b.place != null).length,
          });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [id]);

  if (!result) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</Screen>;

  const { entry, cls, show, test, movements, judges, combined } = result;
  const visible = judges.filter((j) => j.sheet);
  const selected = visible.find((j) => j.classJudge.id === view);

  async function download() {
    setBusy(true);
    try {
      await shareScoreSheet(result!, placing);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Score sheet' }} />
      <View style={{ gap: 2 }}>
        <Title>
          {entry.rider_name} · {entry.horse_name}
        </Title>
        <Muted>
          {[cls.name, show.name, formatDate(show.show_date), test.code ? `${test.code} ${test.name}` : test.name].join(' · ')}
        </Muted>
      </View>

      <Card>
        <View style={styles.resultRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.label}>{judges.length > 1 ? 'Final score (average of judges)' : 'Final score'}</Text>
            <Text style={styles.big}>
              {combined.eliminated ? 'Eliminated' : combined.averagePercentage == null ? '–' : `${combined.averagePercentage.toFixed(3)}%`}
            </Text>
            {combined.signed < combined.total && (
              <Text style={styles.provisional}>
                Provisional: {combined.signed} of {combined.total} judges have signed
              </Text>
            )}
          </View>
          {placing?.place != null && (
            <View style={styles.placeBox}>
              <Text style={styles.placeText}>{ordinal(placing.place, placing.shared)}</Text>
              <Muted>of {placing.of}</Muted>
            </View>
          )}
        </View>
        {judges.map((j) => (
          <View key={j.classJudge.id} style={styles.judgeLine}>
            <Text style={styles.position}>{j.classJudge.position}</Text>
            <Text style={{ flex: 1, fontSize: 15 }}>{j.judgeName}</Text>
            <Text style={styles.judgePct}>{judgeScore(j)}</Text>
          </View>
        ))}
        <View style={{ marginTop: 8 }}>
          <Button label="Download PDF" variant="secondary" onPress={download} busy={busy} disabled={visible.length === 0} />
        </View>
        <ErrorText>{error}</ErrorText>
      </Card>

      {visible.length === 0 && <Muted>No signed sheets to show yet.</Muted>}
      {visible.length > 1 && (
        <Row>
          <Chip label="All judges" selected={view === 'compare'} onPress={() => setView('compare')} />
          {visible.map((j) => (
            <Chip
              key={j.classJudge.id}
              label={`${j.classJudge.position} · ${j.judgeName}`}
              selected={view === j.classJudge.id}
              onPress={() => setView(j.classJudge.id)}
            />
          ))}
        </Row>
      )}

      {view === 'compare' && visible.length > 1 ? (
        <CompareTable movements={movements} judges={visible} narrow={width < 600} />
      ) : selected ? (
        <JudgeSheetView movements={movements} judge={selected} />
      ) : null}
    </Screen>
  );
}

function judgeScore(j: JudgeSheet) {
  if (!j.sheet || !j.totals) return 'Not available';
  if (j.sheet.status !== 'signed') return SHEET_STATUS_LABELS[j.sheet.status];
  if (j.totals.eliminated) return 'Eliminated';
  return `${formatPoints(j.totals.finalPoints)} pts · ${j.totals.percentage.toFixed(3)}%`;
}

function JudgeSheetView({ movements, judge }: { movements: TestMovement[]; judge: JudgeSheet }) {
  const sheet = judge.sheet!;
  const t = judge.totals!;
  const section = (title: string, list: TestMovement[]) =>
    list.length === 0 ? null : (
      <Card>
        <Text style={styles.heading}>{title}</Text>
        {list.map((m) => {
          const s = judge.marks[m.id];
          return (
            <View key={m.id} style={styles.movement}>
              <Text style={styles.number}>{m.number}</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15 }}>
                  {m.markers ? <Text style={{ color: colors.muted }}>{m.markers}  </Text> : null}
                  {m.description}
                  {m.coefficient > 1 ? <Text style={styles.coef}>  ×{m.coefficient}</Text> : null}
                </Text>
                {s?.comment ? <Text style={styles.comment}>{s.comment}</Text> : null}
              </View>
              <Text style={styles.mark}>{formatMark(s?.mark)}</Text>
            </View>
          );
        })}
      </Card>
    );

  return (
    <>
      <Muted>
        Judge at {judge.classJudge.position}: {judge.judgeName}
        {sheet.status === 'signed' && sheet.signed_at
          ? ` · signed ${new Date(sheet.signed_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
          : ` · ${SHEET_STATUS_LABELS[sheet.status]}`}
      </Muted>
      {section('Movements', movements.filter((m) => !m.is_collective))}
      {section('Collective marks', movements.filter((m) => m.is_collective))}
      <Card>
        <Line label="Points" value={`${formatPoints(t.rawPoints)} / ${formatPoints(t.maxPoints)}`} />
        {sheet.errors_of_course > 0 && (
          <Line
            label={`Errors of course (${sheet.errors_of_course})`}
            value={t.eliminated ? 'Eliminated' : `−${formatPoints(t.errorPenalty)}`}
          />
        )}
        {sheet.other_deductions > 0 && <Line label="Other deductions" value={`−${formatPoints(sheet.other_deductions)}`} />}
        <Line
          label="Total"
          value={t.eliminated ? 'Eliminated' : `${formatPoints(t.finalPoints)} · ${t.percentage.toFixed(3)}%`}
          bold
        />
      </Card>
      {sheet.general_comment ? (
        <Card>
          <Text style={styles.heading}>Judge's comments</Text>
          <Text style={[styles.comment, { fontSize: 15 }]}>{sheet.general_comment}</Text>
        </Card>
      ) : null}
    </>
  );
}

/** Every judge's mark side by side, for multi-judge classes. */
function CompareTable({ movements, judges, narrow }: { movements: TestMovement[]; judges: JudgeSheet[]; narrow: boolean }) {
  const colWidth = narrow ? 44 : 64;
  return (
    <Card>
      <View style={styles.compareHead}>
        <Text style={[styles.headCell, { width: 28 }]}>No.</Text>
        <Text style={[styles.headCell, { flex: 1 }]}>Movement</Text>
        {judges.map((j) => (
          <Text key={j.classJudge.id} style={[styles.headCell, { width: colWidth, textAlign: 'center' }]}>
            {j.classJudge.position}
          </Text>
        ))}
      </View>
      {movements.map((m) => {
        const marks = judges.map((j) => j.marks[m.id]?.mark ?? null);
        const spread = Math.max(...marks.map((x) => x ?? 0)) - Math.min(...marks.map((x) => x ?? 0));
        return (
          <View key={m.id} style={styles.compareRow}>
            <Text style={[styles.number, { width: 28 }]}>{m.number}</Text>
            <Text style={{ flex: 1, fontSize: 14 }} numberOfLines={narrow ? 2 : 1}>
              {m.is_collective ? `${m.description} (collective)` : m.description}
              {m.coefficient > 1 ? <Text style={styles.coef}> ×{m.coefficient}</Text> : null}
            </Text>
            {marks.map((mark, i) => (
              <Text
                key={judges[i].classJudge.id}
                style={[styles.compareMark, { width: colWidth }, spread >= 2 && { color: colors.danger }]}
              >
                {formatMark(mark)}
              </Text>
            ))}
          </View>
        );
      })}
      <View style={[styles.compareRow, { borderTopWidth: 2, borderTopColor: colors.text }]}>
        <Text style={[styles.headCell, { flex: 1 }]}>Percentage</Text>
        {judges.map((j) => (
          <Text key={j.classJudge.id} style={[styles.compareMark, { width: colWidth, fontSize: narrow ? 12 : 14 }]}>
            {j.totals?.eliminated ? 'E' : j.totals ? j.totals.percentage.toFixed(narrow ? 1 : 2) : '–'}
          </Text>
        ))}
      </View>
      <Muted>Marks two or more apart between judges are shown in red. Pick a judge above to read their comments.</Muted>
    </Card>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={[{ fontSize: 15 }, bold && { fontWeight: '700' }]}>{label}</Text>
      <Text style={[{ fontSize: 15 }, bold && { fontWeight: '700', color: colors.primary }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase' },
  big: { fontSize: 32, fontWeight: '800', color: colors.primary },
  provisional: { fontSize: 13, color: colors.danger },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  placeBox: { alignItems: 'center', backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  placeText: { fontSize: 24, fontWeight: '800', color: colors.primaryText },
  judgeLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  position: { width: 24, fontSize: 16, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  judgePct: { fontSize: 15, fontWeight: '600' },
  movement: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
  number: { width: 24, fontSize: 15, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  coef: { color: colors.accent, fontWeight: '700' },
  comment: { fontStyle: 'italic', color: colors.muted, fontSize: 14 },
  mark: { minWidth: 40, fontSize: 22, fontWeight: '800', textAlign: 'right', color: colors.text },
  headCell: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' },
  compareHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border },
  compareMark: { textAlign: 'center', fontSize: 16, fontWeight: '700' },
});
