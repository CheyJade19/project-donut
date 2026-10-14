import { useEffect, useState } from 'react';

import { Button, Chip, ErrorText, Field, Muted, Row, Screen } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { ROLE_LABELS, type AppRole } from '@/lib/types';
import { useAuth } from '@/providers/AuthProvider';

const PROFILE_ROLES: AppRole[] = ['rider', 'judge', 'scribe'];

export default function ProfileScreen() {
  const { profile, session, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [judgeLevel, setJudgeLevel] = useState('');
  const [phone, setPhone] = useState('');
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name);
    setJudgeLevel(profile.judge_level ?? '');
    setPhone(profile.phone ?? '');
    setRoles(profile.roles);
  }, [profile]);

  function toggle(role: AppRole) {
    setSaved(false);
    setRoles((current) => (current.includes(role) ? current.filter((r) => r !== role) : [...current, role]));
  }

  async function save() {
    if (!profile) return;
    setBusy(true);
    setError('');
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        judge_level: roles.includes('judge') ? judgeLevel.trim() || null : null,
        phone: phone.trim() || null,
        roles,
      })
      .eq('id', profile.id);
    setBusy(false);
    if (error) setError(error.message);
    else {
      setSaved(true);
      await refreshProfile();
    }
  }

  return (
    <Screen>
      <Muted>{session?.user.email}</Muted>
      <Field label="Full name" value={fullName} onChangeText={(t) => { setFullName(t); setSaved(false); }} />
      <Field label="Phone" value={phone} onChangeText={(t) => { setPhone(t); setSaved(false); }} keyboardType="phone-pad" />
      <Muted>Roles</Muted>
      <Row>
        {PROFILE_ROLES.map((role) => (
          <Chip key={role} label={ROLE_LABELS[role]} selected={roles.includes(role)} onPress={() => toggle(role)} />
        ))}
        {profile?.roles.includes('organiser') && <Chip label="Organiser" selected onPress={() => {}} />}
      </Row>
      {roles.includes('judge') && (
        <Field label="Judge level" value={judgeLevel} onChangeText={(t) => { setJudgeLevel(t); setSaved(false); }} placeholder="e.g. C, B, A, List" />
      )}
      <ErrorText>{error}</ErrorText>
      {saved ? <Muted>Saved.</Muted> : null}
      <Button label="Save" onPress={save} busy={busy} disabled={!fullName.trim() || roles.length === 0} />
    </Screen>
  );
}
