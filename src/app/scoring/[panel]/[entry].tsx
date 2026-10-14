import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { SyncBadge } from '@/components/SyncBadge';
import { Button, Card, Chip, ErrorText, Muted, Row, Screen, colors } from '@/components/ui';
import { usePanel } from '@/hooks/usePanel';
import { formatMark, formatPoints } from '@/lib/format';
import type { LocalSheet, SheetEdit } from '@/lib/offline/sheets';
import { totalsByMovementId, type SheetTotals } from '@/lib/scoring';
import type { AssignmentBundle } from '@/lib/scoringApi';
import { SHEET_STATUS_LABELS, type TestMovement } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';
import { useLocalSheet } from '@/providers/SyncProvider';

/** Remarks judges use all the time; tapping one adds it to the comment. */
const QUICK_REMARKS = [
  'Accurate',
  'Good rhythm',
  'Active',
  'Not straight',
  'Lacked bend',
  'Hurried',
  'Lacked energy',
  'Tense',
  'Above the bit',
  'Behind the vertical',
  'Late transition',
  'Early transition',
  'Inaccurate figure',
  'Broke gait',
  'Resistance',
  'Unsettled halt',
];

const WHOLE_MARKS = Array.from({ length: 11 }, (_, i) => i);

/**
 * The scribe's sheet: one movement at a time with big mark buttons, then a
 * summary where the scribe sends the sheet to the judge and the judge signs.
 * Every tap is saved on the device first and uploaded when there is signal.
 */
export default function ScoreSheetScreen() {
  const { panel, entry: entryId } = useLocalSearchParams<{ panel: string; entry: string }>();
  const { bundle, error } = usePanel(panel);
  const { sheet, edit, ready } = useLocalSheet(panel, entryId);
  const { session } = useAuth();
  const [step, setStep] = useState(0);
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const movements = useMemo(
    () => [...(bundle?.movements ?? [])].sort((a, b) => a.number - b.number),
    [bundle?.movements],
  );

  // Start where the scribe left off: the first movement without a mark.
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (resumed || !ready || movements.length === 0) return;
    const first = movements.findIndex((m) => sheet?.marks[m.id]?.mark == null);
    setStep(first === -1 ? movements.length : first);
    setResumed(true);
  }, [movements, ready, resumed, sheet]);

  if (!bundle) return <Screen>{error ? <ErrorText>{error}</ErrorText> : <Muted>Loading…</Muted>}</Screen>;
  const entry = bundle.entries.find((e) => e.id === entryId);
  if (!entry) return <Screen><ErrorText>This rider is no longer in the class.</ErrorText></Screen>;

  const marks = sheet?.marks ?? {};
  const totals = totalsByMovementId(movements, marks, {
    errorsOfCourse: sheet?.errorsOfCourse ?? 0,
    errorPenalties: bundle.test.error_penalties,
    otherDeductions: sheet?.otherDeductions ?? 0,
    eliminated: sheet?.eliminated ?? false,
  });
  const locked = sheet?.status === 'signed';
  const isJudge = bundle.classJudge.judge_id === session?.user.id;
  const onSummary = step >= movements.length;
  const current = movements[step];

  const nextEntry = bundle.entries.find(
    (e) => !e.withdrawn && (e.draw_order ?? 0) > (entry.draw_order ?? 0) && e.id !== entry.id,
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: `${entry.draw_order ? `${entry.draw_order}. ` : ''}${entry.rider_name}` }} />

      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 200, gap: 4 }}>
          <Text style={styles.headerName}>
            {entry.rider_name} · {entry.horse_name}
          </Text>
          <SyncBadge />
        </View>
        <ErrorsOfCourse
          count={sheet?.errorsOfCourse ?? 0}
          penalties={bundle.test.error_penalties}
          disabled={locked}
          onChange={(value) => edit({ type: 'errorsOfCourse', value })}
        />
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.headerPct}>{totals.eliminated ? 'Eliminated' : `${totals.percentage.toFixed(2)}%`}</Text>
          <Muted>
            {formatPoints(totals.finalPoints)} / {totals.maxPoints}
          </Muted>
        </View>
      </View>

      <MovementStrip movements={movements} marks={marks} step={step} onSelect={setStep} />

      {locked && (
        <View style={styles.lockedBanner}>
          <Text style={{ color: colors.primaryText, fontWeight: '600' }}>
            Signed by the judge{sheet?.signedAt ? ` at ${new Date(sheet.signedAt).toLocaleTimeString()}` : ''}. This sheet is final.
          </Text>
        </View>
      )}
      {sheet?.rejected && sheet.rejected.version === sheet.version && (
        <View style={[styles.lockedBanner, { backgroundColor: colors.danger }]}>
          <Text style={{ color: colors.primaryText }}>The server did not accept these marks: {sheet.rejected.message}</Text>
        </View>
      )}

      {onSummary || !current ? (
        <Summary
          bundle={bundle}
          movements={movements}
          sheet={sheet}
          totals={totals}
          isJudge={isJudge}
          locked={locked}
          edit={edit}
          onOpenMovement={setStep}
          onNextRider={
            nextEntry
              ? () => router.replace({ pathname: '/scoring/[panel]/[entry]', params: { panel, entry: nextEntry.id } })
              : undefined
          }
          onBackToDraw={() => router.back()}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.body, wide && styles.bodyWide]} keyboardShouldPersistTaps="handled">
          <View style={[styles.movementInfo, wide && { flex: 1 }]}>
            <Row>
              <Text style={styles.movementNumber}>{current.is_collective ? 'Collective' : `Movement ${current.number}`}</Text>
              {current.coefficient > 1 && <Text style={styles.coef}>×{current.coefficient}</Text>}
            </Row>
            {current.markers ? <Text style={styles.markers}>{current.markers}</Text> : null}
            <Text style={styles.description}>{current.description}</Text>
            {current.directive_ideas ? <Muted>{current.directive_ideas}</Muted> : null}
          </View>

          <View style={[{ gap: 12 }, wide && { flex: 1.3 }]}>
            <MarkPad
              value={marks[current.id]?.mark ?? null}
              max={current.max_mark}
              disabled={locked}
              onChange={(mark) => edit({ type: 'mark', movementId: current.id, mark })}
            />
            <CommentBox
              key={current.id}
              value={marks[current.id]?.comment ?? ''}
              disabled={locked}
              onChange={(comment) => edit({ type: 'comment', movementId: current.id, comment })}
            />
            <Row>
              <View style={{ flex: 1 }}>
                <Button label="‹ Back" variant="secondary" onPress={() => setStep(Math.max(0, step - 1))} disabled={step === 0} />
              </View>
              <View style={{ flex: 2 }}>
                <Button
                  label={step === movements.length - 1 ? 'Finish ›' : 'Next ›'}
                  onPress={() => setStep(step + 1)}
                />
              </View>
            </Row>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function MarkPad({
  value,
  max,
  disabled,
  onChange,
}: {
  value: number | null;
  max: number;
  disabled: boolean;
  onChange: (mark: number | null) => void;
}) {
  const whole = value == null ? null : Math.floor(value);
  const half = value != null && value % 1 !== 0;

  return (
    <View style={{ gap: 8 }}>
      <View style={styles.markGrid}>
        {WHOLE_MARKS.filter((m) => m <= max).map((m) => {
          const selected = whole === m;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${m}`}
              accessibilityState={{ selected, disabled }}
              disabled={disabled}
              onPress={() => onChange(selected && !half ? null : m)}
              style={({ pressed }) => [styles.markButton, selected && styles.markSelected, pressed && { opacity: 0.7 }]}
            >
              <Text style={[styles.markText, selected && { color: colors.primaryText }]}>{m}</Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add a half mark"
          accessibilityState={{ selected: half, disabled: disabled || whole == null || whole + 0.5 > max }}
          disabled={disabled || whole == null || whole + 0.5 > max}
          onPress={() => whole != null && onChange(half ? whole : whole + 0.5)}
          style={({ pressed }) => [
            styles.markButton,
            styles.halfButton,
            half && styles.markSelected,
            (whole == null || whole + 0.5 > max) && { opacity: 0.4 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.markText, half && { color: colors.primaryText }]}>+½</Text>
        </Pressable>
      </View>
      <Text style={styles.currentMark}>{value == null ? 'No mark yet' : `Mark: ${formatMark(value)}`}</Text>
    </View>
  );
}

/**
 * Keeps its own text while typing so each keystroke is not a separate edit
 * in the upload queue; saves when the scribe pauses or leaves the movement.
 */
function CommentBox({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (comment: string) => void;
}) {
  const [text, setText] = useState(value);
  // Only what the scribe typed is saved; a sheet arriving from the server
  // replaces the box's text instead of being overwritten by it.
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setText(value);
  }, [value]);

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => save(text), 500);
    return () => clearTimeout(timer);
  }, [text]);

  function save(next: string) {
    typed.current = false;
    if (next !== value) onChange(next);
  }

  function type(next: string) {
    typed.current = true;
    setText(next);
  }

  function addRemark(remark: string) {
    const trimmed = text.trim();
    const next = trimmed ? `${trimmed.replace(/[.,;]$/, '')}, ${remark.toLowerCase()}` : remark;
    setText(next);
    save(next);
  }

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={text}
        onChangeText={type}
        onBlur={() => typed.current && save(text)}
        editable={!disabled}
        multiline
        placeholder="Comment"
        placeholderTextColor={colors.muted}
        style={styles.comment}
      />
      {!disabled && (
        <View style={styles.remarks}>
          {QUICK_REMARKS.map((r) => (
            <Pressable key={r} accessibilityRole="button" onPress={() => addRemark(r)} style={styles.remark}>
              <Text style={{ fontSize: 14 }}>{r}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ErrorsOfCourse({
  count,
  penalties,
  disabled,
  onChange,
}: {
  count: number;
  penalties: number[];
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const eliminated = count > penalties.length;
  const penalty = penalties.slice(0, count).reduce((s, p) => s + p, 0);
  return (
    <View style={styles.errors}>
      <Text style={{ fontWeight: '600' }}>Errors of course</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Remove an error of course"
          disabled={disabled || count === 0}
          onPress={() => onChange(count - 1)}
          style={styles.stepper}
        >
          <Text style={styles.stepperText}>−</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: '700', minWidth: 24, textAlign: 'center' }}>{count}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add an error of course"
          disabled={disabled || eliminated}
          onPress={() => onChange(count + 1)}
          style={styles.stepper}
        >
          <Text style={styles.stepperText}>+</Text>
        </Pressable>
      </View>
      <Muted>{eliminated ? 'Eliminated' : count > 0 ? `−${penalty} points` : ' '}</Muted>
    </View>
  );
}

function MovementStrip({
  movements,
  marks,
  step,
  onSelect,
}: {
  movements: TestMovement[];
  marks: LocalSheet['marks'];
  step: number;
  onSelect: (step: number) => void;
}) {
  return (
    <ScrollView horizontal style={styles.strip} contentContainerStyle={{ gap: 6, padding: 8 }}>
      {movements.map((m, i) => {
        const mark = marks[m.id]?.mark;
        return (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            accessibilityLabel={`Movement ${m.number}, ${mark == null ? 'no mark' : `mark ${mark}`}`}
            onPress={() => onSelect(i)}
            style={[styles.pill, mark != null && styles.pillDone, i === step && styles.pillCurrent]}
          >
            <Text style={styles.pillNumber}>{m.is_collective ? `C${m.number}` : m.number}</Text>
            <Text style={styles.pillMark}>{formatMark(mark)}</Text>
          </Pressable>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={() => onSelect(movements.length)}
        style={[styles.pill, styles.pillSummary, step >= movements.length && styles.pillCurrent]}
      >
        <Text style={styles.pillNumber}>Sheet</Text>
        <Text style={styles.pillMark}>✓</Text>
      </Pressable>
    </ScrollView>
  );
}

function Summary({
  bundle,
  movements,
  sheet,
  totals,
  isJudge,
  locked,
  edit,
  onOpenMovement,
  onNextRider,
  onBackToDraw,
}: {
  bundle: AssignmentBundle;
  movements: TestMovement[];
  sheet: LocalSheet | undefined;
  totals: SheetTotals;
  isJudge: boolean;
  locked: boolean;
  edit: (e: SheetEdit) => void;
  onOpenMovement: (step: number) => void;
  onNextRider?: () => void;
  onBackToDraw: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deductions, setDeductions] = useState(String(sheet?.otherDeductions ?? 0));
  const status = sheet?.status ?? 'draft';
  const complete = totals.missing === 0;

  function saveDeductions(text: string) {
    setDeductions(text);
    const n = Number(text.replace(',', '.'));
    if (text.trim() === '' || (Number.isFinite(n) && n >= 0)) edit({ type: 'otherDeductions', value: text.trim() === '' ? 0 : n });
  }

  return (
    <Screen>
      <Card>
        <Text style={styles.summaryHeading}>Score sheet · {SHEET_STATUS_LABELS[status]}</Text>
        {movements.map((m, i) => {
          const mk = sheet?.marks[m.id];
          return (
            <Pressable key={m.id} onPress={() => onOpenMovement(i)} style={styles.summaryRow}>
              <Text style={styles.summaryNum}>{m.is_collective ? 'C' : m.number}</Text>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1}>{m.markers ? `${m.markers}  ` : ''}{m.description}</Text>
                {mk?.comment ? <Muted>{mk.comment}</Muted> : null}
              </View>
              <Text style={[styles.summaryMark, mk?.mark == null && { color: colors.danger }]}>{formatMark(mk?.mark)}</Text>
              <Text style={styles.summaryPoints}>
                {m.coefficient > 1 ? `×${m.coefficient} ` : ''}
                {mk?.mark != null ? formatPoints(mk.mark * m.coefficient) : ''}
              </Text>
            </Pressable>
          );
        })}
      </Card>

      <Card>
        <TotalLine label="Marks" value={`${formatPoints(totals.rawPoints)} / ${totals.maxPoints}`} />
        <TotalLine
          label={`Errors of course (${sheet?.errorsOfCourse ?? 0})`}
          value={totals.eliminated && (sheet?.errorsOfCourse ?? 0) > bundle.test.error_penalties.length ? 'Eliminated' : `−${formatPoints(totals.errorPenalty)}`}
        />
        <View style={styles.totalLine}>
          <Text style={{ flex: 1 }}>Other deductions (technical errors etc.)</Text>
          <TextInput
            value={deductions}
            onChangeText={saveDeductions}
            editable={!locked}
            keyboardType="decimal-pad"
            style={[styles.comment, { minHeight: 0, width: 80, textAlign: 'right' }]}
          />
        </View>
        <TotalLine label="Total" value={totals.eliminated ? 'Eliminated' : formatPoints(totals.finalPoints)} bold />
        <TotalLine label="Percentage" value={totals.eliminated ? '–' : `${totals.percentage.toFixed(3)}%`} bold />
      </Card>

      <Card>
        <Text style={{ fontWeight: '600' }}>General comment</Text>
        <CommentBox
          value={sheet?.generalComment ?? ''}
          disabled={locked}
          onChange={(value) => edit({ type: 'generalComment', value })}
        />
        <Row>
          <Chip
            label="Eliminated (other reason)"
            selected={sheet?.eliminated ?? false}
            onPress={() => !locked && edit({ type: 'eliminated', value: !(sheet?.eliminated ?? false) })}
          />
        </Row>
      </Card>

      {!complete && !locked && (
        <ErrorText>
          {totals.missing} movement{totals.missing === 1 ? '' : 's'} still need{totals.missing === 1 ? 's' : ''} a mark (shown in red).
        </ErrorText>
      )}

      {!locked && !isJudge && status === 'draft' && (
        <Button label="Send to judge" disabled={!complete} onPress={() => edit({ type: 'status', value: 'submitted' })} />
      )}
      {!locked && !isJudge && status === 'submitted' && (
        <Muted>Sent to the judge to sign. You can still correct marks until they sign.</Muted>
      )}

      {!locked && isJudge &&
        (confirming ? (
          <Card>
            <Text style={{ fontWeight: '600' }}>Sign this sheet?</Text>
            <Muted>
              Signing confirms these marks and comments as your final scores for {totals.eliminated ? 'this rider (eliminated)' : `${totals.percentage.toFixed(3)}%`}. Only an organiser can reopen it after that.
            </Muted>
            <Row>
              <Button
                label="Sign"
                onPress={() => {
                  edit({ type: 'status', value: 'signed' });
                  setConfirming(false);
                }}
              />
              <Button label="Cancel" variant="secondary" onPress={() => setConfirming(false)} />
            </Row>
          </Card>
        ) : (
          <Button label="Sign sheet" disabled={!complete} onPress={() => setConfirming(true)} />
        ))}

      <Row>
        {onNextRider && (status !== 'draft' || locked) && <Button label="Next rider ›" onPress={onNextRider} />}
        <Button label="Back to the draw" variant="secondary" onPress={onBackToDraw} />
      </Row>
    </Screen>
  );
}

function TotalLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.totalLine}>
      <Text style={[{ flex: 1 }, bold && { fontWeight: '700' }]}>{label}</Text>
      <Text style={[{ fontSize: 16 }, bold && { fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
    padding: 12,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerName: { fontSize: 18, fontWeight: '700' },
  headerPct: { fontSize: 26, fontWeight: '800', color: colors.primary },
  errors: { alignItems: 'center', gap: 2 },
  stepper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  stepperText: { fontSize: 24, color: colors.primary, fontWeight: '700' },
  strip: { flexGrow: 0, backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  pill: {
    minWidth: 48,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  pillDone: { backgroundColor: '#E3EEE9' },
  pillCurrent: { borderColor: colors.primary, borderWidth: 3 },
  pillSummary: { backgroundColor: '#F3EBD6' },
  pillNumber: { fontSize: 12, color: colors.muted },
  pillMark: { fontSize: 16, fontWeight: '700' },
  lockedBanner: { backgroundColor: colors.primary, padding: 10 },
  body: { padding: 16, gap: 16, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  bodyWide: { flexDirection: 'row', alignItems: 'flex-start' },
  movementInfo: { gap: 8, backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border },
  movementNumber: { fontSize: 16, fontWeight: '700', color: colors.muted },
  coef: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.primaryText,
    backgroundColor: colors.accent,
    borderRadius: 6,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  markers: { fontSize: 28, fontWeight: '800', color: colors.primary },
  description: { fontSize: 20, lineHeight: 28 },
  markGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  markButton: {
    width: 72,
    height: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halfButton: { borderColor: colors.accent, borderWidth: 2 },
  markSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  markText: { fontSize: 28, fontWeight: '700', color: colors.text },
  currentMark: { fontSize: 18, fontWeight: '600', color: colors.primary },
  comment: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 17,
    minHeight: 80,
    color: colors.text,
    textAlignVertical: 'top',
  },
  remarks: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  remark: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.card,
  },
  summaryHeading: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  summaryNum: { width: 28, fontWeight: '700', color: colors.primary },
  summaryMark: { width: 40, fontSize: 18, fontWeight: '700', textAlign: 'right' },
  summaryPoints: { width: 64, textAlign: 'right', color: colors.muted },
  totalLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
});
