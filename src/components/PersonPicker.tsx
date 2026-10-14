import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Field, Muted, colors } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import type { AppRole } from '@/lib/types';

export type PersonOption = { id: string; full_name: string; judge_level: string | null };

/** Search people with an account by name, optionally only those with a role. */
export function PersonPicker({
  label,
  role,
  selected,
  onSelect,
}: {
  label: string;
  role?: AppRole;
  selected: PersonOption | null;
  onSelect: (person: PersonOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PersonOption[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      let request = supabase
        .from('profiles')
        .select('id, full_name, judge_level')
        .ilike('full_name', `%${q.replace(/[%_]/g, '')}%`)
        .order('full_name')
        .limit(8);
      if (role) request = request.contains('roles', [role]);
      const { data } = await request;
      if (active) setResults((data ?? []) as PersonOption[]);
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, role]);

  if (selected) {
    return (
      <View style={{ gap: 4 }}>
        <Text style={{ fontWeight: '600' }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 16 }}>
            {selected.full_name}
            {selected.judge_level ? ` (${selected.judge_level})` : ''}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => onSelect(null)}>
            <Text style={{ color: colors.primary }}>Change</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ gap: 4 }}>
      <Field label={label} value={query} onChangeText={setQuery} placeholder="Type a name" />
      {query.trim().length >= 2 && results.length === 0 && (
        <Muted>No one found{role ? ` with the ${role} role` : ''}. They need an account with that role in their profile.</Muted>
      )}
      {results.map((p) => (
        <Pressable
          key={p.id}
          accessibilityRole="button"
          onPress={() => {
            onSelect(p);
            setQuery('');
          }}
          style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text style={{ fontSize: 16 }}>
            {p.full_name}
            {p.judge_level ? ` (${p.judge_level})` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
