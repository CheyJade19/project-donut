import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SyncBadge } from '@/components/SyncBadge';
import { Button, Card, ErrorText, Muted, Row, Screen, colors } from '@/components/ui';
import { usePanel } from '@/hooks/usePanel';
import { formatTime } from '@/lib/format';
import type { LocalSheet } from '@/lib/offline/sheets';
import { totalsByMovementId } from '@/lib/scoring';
import { SHEET_STATUS_LABELS, type Entry, type TestMovement } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { usePanelSheets, useSync } from '@/providers/SyncProvider';

/** The draw for one judge's panel, with each rider's sheet status. */
export default function PanelDraw() {
  const { panel } = useLocalSearchParams<{ panel: string }>();
  const { session } = useAuth();
  const { store } = useSync();
  const { bundle, error, fromCache } = usePanel(panel);
  const sheets = usePanelSheets(panel);
  const [confirmSignAll, setConfirmSignAll] = useState(false);

  if (!bundle) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</Screen>;

  const isJudge = bundle.classJudge.judge_id === session?.user.id;
  const readyToSign = bundle.entries.filter((e) => {
    const s = sheets[e.id];
    return s?.status === 'submitted' && totals(bundle.movements, s, bundle.test.error_penalties).missing === 0;
  });

  function signAll() {
    for (const e of readyToSign) store?.edit(panel, e.id, { type: 'status', value: 'signed' });
    setConfirmSignAll(false);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: bundle.cls.name }} />
      <SyncBadge />
      <Muted>
        {[bundle.show.name, bundle.arena?.name, bundle.test.code || bundle.test.name, `Judge at ${bundle.classJudge.position}: ${bundle.judgeName}`]
          .filter(Boolean)
          .join(' · ')}
      </Muted>
      {fromCache && error ? <Muted>No signal. Using the draw saved on this device.</Muted> : null}

      {isJudge && readyToSign.length > 0 && (
        <Card>
          <Text style={styles.heading}>
            {readyToSign.length} sheet{readyToSign.length === 1 ? '' : 's'} ready for your signature
          </Text>
          {confirmSignAll ? (
            <>
              <Muted>You are signing the marks and comments on these sheets as your final scores.</Muted>
              <Row>
                <Button label={`Sign ${readyToSign.length}`} onPress={signAll} />
                <Button label="Cancel" variant="secondary" onPress={() => setConfirmSignAll(false)} />
              </Row>
            </>
          ) : (
            <Row>
              <Button label="Sign all" onPress={() => setConfirmSignAll(true)} />
              <Muted>or open a rider to review their sheet first.</Muted>
            </Row>
          )}
        </Card>
      )}

      {bundle.entries.length === 0 && <Muted>No riders in this class yet.</Muted>}
      {bundle.entries.map((entry) => (
        <EntryRow
          key={entry.id}
          entry={entry}
          sheet={sheets[entry.id]}
          movements={bundle.movements}
          penalties={bundle.test.error_penalties}
          onPress={() =>
            router.push({ pathname: '/scoring/[panel]/[entry]', params: { panel, entry: entry.id } })
          }
        />
      ))}
    </Screen>
  );
}

function totals(movements: TestMovement[], sheet: LocalSheet, penalties: number[]) {
  return totalsByMovementId(movements, sheet.marks, {
    errorsOfCourse: sheet.errorsOfCourse,
    errorPenalties: penalties,
    otherDeductions: sheet.otherDeductions,
    eliminated: sheet.eliminated,
  });
}

function EntryRow({
  entry,
  sheet,
  movements,
  penalties,
  onPress,
}: {
  entry: Entry;
  sheet: LocalSheet | undefined;
  movements: TestMovement[];
  penalties: number[];
  onPress: () => void;
}) {
  const t = sheet ? totals(movements, sheet, penalties) : null;
  const started = sheet && Object.values(sheet.marks).some((m) => m.mark != null);
  const status = !sheet || (!started && sheet.status === 'draft') ? 'Not started' : SHEET_STATUS_LABELS[sheet.status];
  const unsent = sheet && sheet.version > sheet.syncedVersion;

  return (
    <Card onPress={entry.withdrawn ? undefined : onPress}>
      <View style={styles.row}>
        <Text style={styles.draw}>{entry.draw_order ?? '–'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, entry.withdrawn && styles.withdrawn]}>
            {entry.rider_name} · {entry.horse_name}
          </Text>
          <Muted>
            {[
              entry.start_time && formatTime(entry.start_time),
              entry.withdrawn ? 'Withdrawn' : status,
              t && started && t.missing > 0 && `${t.missing} to mark`,
              unsent && 'Saved on device',
              sheet?.rejected && sheet.rejected.version === sheet.version && `Not accepted: ${sheet.rejected.message}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Muted>
        </View>
        {t && started && (
          <Text style={styles.pct}>{t.eliminated ? 'Elim' : `${t.percentage.toFixed(2)}%`}</Text>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  draw: { width: 32, fontSize: 20, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  name: { fontSize: 17, fontWeight: '600' },
  withdrawn: { color: colors.muted, textDecorationLine: 'line-through' },
  pct: { fontSize: 18, fontWeight: '700', color: colors.primary },
});
