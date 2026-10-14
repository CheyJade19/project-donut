import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';

import { colors } from '@/components/ui';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SyncProvider } from '@/providers/SyncProvider';

function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.primaryText,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ title: 'eq ScoreBoard' }} />
        <Stack.Screen name="profile" options={{ title: 'My profile' }} />
        <Stack.Screen name="tests/index" options={{ title: 'Test library' }} />
        <Stack.Screen name="tests/[id]" options={{ title: 'Test' }} />
        <Stack.Screen name="tests/edit" options={{ title: 'Edit test' }} />
        <Stack.Screen name="scoring/index" options={{ title: 'Judging and scribing' }} />
        <Stack.Screen name="scoring/[panel]/index" options={{ title: 'Draw' }} />
        <Stack.Screen name="scoring/[panel]/[entry]" options={{ title: 'Score sheet' }} />
        <Stack.Screen name="organiser/index" options={{ title: 'Organise shows' }} />
        <Stack.Screen name="organiser/show/[id]" options={{ title: 'Show' }} />
        <Stack.Screen name="organiser/class/[id]" options={{ title: 'Class' }} />
        <Stack.Screen name="results/index" options={{ title: 'Results' }} />
        <Stack.Screen name="results/class/[id]" options={{ title: 'Leaderboard' }} />
        <Stack.Screen name="results/entry/[id]" options={{ title: 'Score sheet' }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <SyncProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </SyncProvider>
    </AuthProvider>
  );
}
