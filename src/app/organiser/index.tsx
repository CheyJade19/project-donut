import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';

import { Button, Card, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { SHOW_STATUS_LABELS, type Club, type Show } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

/** Clubs this person organises, their shows, and forms to add either. */
export default function OrganiserHome() {
  const { session, refreshProfile } = useAuth();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [shows, setShows] = useState<Show[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newClub, setNewClub] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from('club_members')
      .select('clubs(*)')
      .eq('user_id', session.user.id)
      .eq('role', 'organiser');
    if (error) return setError(error.message);
    const mine = ((data ?? []) as unknown as { clubs: Club | null }[])
      .map((r) => r.clubs)
      .filter((c): c is Club => c !== null);
    setClubs(mine);
    if (mine.length > 0) {
      const s = await supabase
        .from('shows')
        .select('*')
        .in('club_id', mine.map((c) => c.id))
        .order('show_date', { ascending: false });
      if (s.error) setError(s.error.message);
      setShows((s.data ?? []) as Show[]);
    }
    setLoaded(true);
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function createClub() {
    setBusy(true);
    setError('');
    const { error } = await supabase.from('clubs').insert({ name: newClub.trim(), created_by: session?.user.id });
    setBusy(false);
    if (error) return setError(error.message);
    setNewClub('');
    await refreshProfile();
    load();
  }

  return (
    <Screen>
      <ErrorText>{error}</ErrorText>
      {loaded && clubs.length === 0 && (
        <Muted>Create your club to start setting up shows. You become its organiser.</Muted>
      )}

      {clubs.map((club) => (
        <ClubShows key={club.id} club={club} shows={shows.filter((s) => s.club_id === club.id)} onCreated={load} />
      ))}

      <Card>
        <Text style={{ fontSize: 17, fontWeight: '700' }}>{clubs.length ? 'Add another club' : 'Create a club'}</Text>
        <Field label="Club name" value={newClub} onChangeText={setNewClub} placeholder="e.g. Riverside Pony Club" />
        <Button label="Create club" onPress={createClub} busy={busy} disabled={!newClub.trim()} />
      </Card>
    </Screen>
  );
}

function ClubShows({ club, shows, onCreated }: { club: Club; shows: Show[]; onCreated: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || Number.isNaN(new Date(date.trim()).getTime())) {
      return setError('Enter the date as year-month-day, like 2026-11-01.');
    }
    setBusy(true);
    setError('');
    const { data, error } = await supabase
      .from('shows')
      .insert({ club_id: club.id, name: name.trim(), venue: venue.trim() || null, show_date: date.trim() })
      .select('id')
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setAdding(false);
    setName('');
    setVenue('');
    setDate('');
    onCreated();
    router.push({ pathname: '/organiser/show/[id]', params: { id: data.id as string } });
  }

  return (
    <>
      <Title>{club.name}</Title>
      {shows.length === 0 && <Muted>No shows yet.</Muted>}
      {shows.map((s) => (
        <Card key={s.id} onPress={() => router.push({ pathname: '/organiser/show/[id]', params: { id: s.id } })}>
          <Text style={{ fontSize: 17, fontWeight: '600' }}>{s.name}</Text>
          <Muted>{[formatDate(s.show_date), s.venue, SHOW_STATUS_LABELS[s.status]].filter(Boolean).join(' · ')}</Muted>
        </Card>
      ))}
      {adding ? (
        <Card>
          <Field label="Show name" value={name} onChangeText={setName} placeholder="e.g. Spring Dressage" />
          <Field label="Venue" value={venue} onChangeText={setVenue} />
          <Field label="Date" value={date} onChangeText={setDate} placeholder="2026-11-01" />
          <ErrorText>{error}</ErrorText>
          <Button label="Create show" onPress={create} busy={busy} disabled={!name.trim() || !date.trim()} />
          <Button label="Cancel" variant="secondary" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <Button label="New show" variant="secondary" onPress={() => setAdding(true)} />
      )}
    </>
  );
}
