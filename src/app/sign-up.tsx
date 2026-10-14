import { useState } from 'react';

import { Button, Chip, ErrorText, Field, Muted, Row, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { ROLE_LABELS, type AppRole } from '@/lib/types';

// Organiser rights are granted per club (by creating one or being added), so
// sign-up only offers the personal roles.
const SIGN_UP_ROLES: AppRole[] = ['rider', 'judge', 'scribe'];

export default function SignUp() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<AppRole[]>(['rider']);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  function toggle(role: AppRole) {
    setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));
  }

  async function signUp() {
    setBusy(true);
    setError('');
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim(), roles } },
    });
    setBusy(false);
    if (error) setError(error.message);
    else if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
  }

  return (
    <Screen>
      <Field label="Full name" value={fullName} onChangeText={setFullName} autoComplete="name" />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      <Muted>I am a… (pick all that apply)</Muted>
      <Row>
        {SIGN_UP_ROLES.map((role) => (
          <Chip key={role} label={ROLE_LABELS[role]} selected={roles.includes(role)} onPress={() => toggle(role)} />
        ))}
      </Row>
      <ErrorText>{error}</ErrorText>
      {notice ? <Muted>{notice}</Muted> : null}
      <Button
        label="Create account"
        onPress={signUp}
        busy={busy}
        disabled={!fullName.trim() || !email || password.length < 6 || roles.length === 0}
      />
    </Screen>
  );
}
