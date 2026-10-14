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

      {hasRole('judge') && (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>My judging</Text>
          <Muted>Your arena, class and test for the day will appear here.</Muted>
        </Card>
      )}
      {hasRole('scribe') && (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>Scribing</Text>
          <Muted>Score sheets for your assigned judge will appear here.</Muted>
        </Card>
      )}
      {hasRole('rider') && (
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>My results</Text>
          <Muted>Your marks and judges' comments will appear here once results are published.</Muted>
        </Card>
      )}

      <Card onPress={() => router.push('/profile')}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>My profile</Text>
        <Muted>Name, roles and judge level.</Muted>
      </Card>

      <Button label="Sign out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
