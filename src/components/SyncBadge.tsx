import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/components/ui';
import { useSync } from '@/providers/SyncProvider';

/** Shows whether every mark on this device has reached the server. Tap to retry. */
export function SyncBadge() {
  const { pending, rejected, offline, syncNow } = useSync();

  let label = 'All marks saved';
  let tone: string = colors.primary;
  if (rejected > 0) {
    label = `${rejected} sheet${rejected === 1 ? '' : 's'} not accepted`;
    tone = colors.danger;
  } else if (pending > 0) {
    label = offline
      ? `No signal · ${pending} sheet${pending === 1 ? '' : 's'} saved on this device`
      : `Uploading ${pending} sheet${pending === 1 ? '' : 's'}…`;
    tone = colors.accent;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to sync now.`}
      onPress={syncNow}
      style={[styles.badge, { borderColor: tone }]}
    >
      <Text style={[styles.dot, { color: tone }]}>●</Text>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.card,
  },
  dot: { fontSize: 12 },
  text: { fontSize: 13, color: colors.text },
});
