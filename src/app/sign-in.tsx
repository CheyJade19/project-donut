import { Link } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { Button, ErrorText, Field, Muted, Screen, Title, colors } from '@/components/ui';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <Screen>
      <Title>eq ScoreBoard</Title>
      <Muted>Paper-free dressage scoring for judges, scribes, riders and organisers.</Muted>
      {!isSupabaseConfigured && (
        <ErrorText>The app is not connected to a backend yet. Add the Supabase keys to .env (see README).</ErrorText>
      )}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <ErrorText>{error}</ErrorText>
      <Button label="Sign in" onPress={signIn} busy={busy} disabled={!email || !password} />
      <Link href="/sign-up">
        <Text style={{ color: colors.primary, fontWeight: '600' }}>New here? Create an account</Text>
      </Link>
    </Screen>
  );
}
