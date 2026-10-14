import { router } from 'expo-router';
import { Text } from 'react-native';

import { Button, Card, Muted, Screen, Title } from '@/components/ui';
import { ROLE_LABELS } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

export default function Home() {
  const { profile, hasRole, signOut } = useAuth();
  const roleList = profile?.roles.map((r) => ROLE_LABELS[r]).join(', ');

  return (
    <Screen>
      <Title>Hi {profile?.full_name || 'there'}</Title>
      {roleList ? <Muted>Signed in as {roleList}</Muted> : null}

      <Card onPress={() => router.push('/tests')}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Test library</Text>
        <Muted>Browse dressage tests, or add and upload new ones.</Muted>
      </Card>

      {(hasRole('judge') || hasRole('scribe')) && (
        <Card onPress={() => router.push('/scoring')}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{hasRole('judge') ? 'My judging' : 'Scribing'}</Text>
          <Muted>Your classes, the draw, and the score sheets. Works without signal.</Muted>
        </Card>
      )}
      <Card onPress={() => router.push('/results')}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>{hasRole('rider') ? 'My results and scoreboards' : 'Results and scoreboards'}</Text>
        <Muted>
          {hasRole('rider')
            ? "Live leaderboards, your placings, and each judge's marks and comments."
            : 'Live leaderboards and published results.'}
        </Muted>
      </Card>

      <Card onPress={() => router.push('/organiser')}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>{hasRole('organiser') ? 'Organise shows' : 'Run a club'}</Text>
        <Muted>
          {hasRole('organiser')
            ? 'Shows, arenas, classes, judges, scribes and the draw.'
            : 'Create your club to set up shows.'}
        </Muted>
      </Card>

      <Card onPress={() => router.push('/profile')}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>My profile</Text>
        <Muted>Name, roles and judge level.</Muted>
      </Card>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
