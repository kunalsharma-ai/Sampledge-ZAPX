import { useState } from 'react';
import { Stack } from 'expo-router';
import { Button, Card, ErrorNote, Field, H2, KV, Screen, Segmented, T } from '@/components/ui';
import { useAction } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { ThemeChoice } from '@/lib/theme';
import Constants from 'expo-constants';

/** The member's own account: always available, whatever the plan. */
export default function Account() {
  const { member, api, theme, setTheme, signOut, adoptToken } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const a = useAction();
  const change = () =>
    a.run(async () => {
      const r = await api.post<{ ok: boolean; token?: string }>('/auth/change-password', { currentPassword: current, newPassword: next });
      if (r.token) await adoptToken(r.token);
      setCurrent('');
      setNext('');
      setDone(true);
    });
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account' }} />
      <Card glow>
        <KV k="Name" v={member?.name ?? '—'} />
        <KV k="Email" v={member?.email ?? '—'} />
        <KV k="Role" v={(member?.role ?? '').toLowerCase()} />
        <KV k="App version" v={Constants.expoConfig?.version ?? '—'} />
      </Card>
      <H2>Theme</H2>
      <Segmented<ThemeChoice>
        value={theme}
        onChange={setTheme}
        options={[
          { key: 'system', label: 'Match device' },
          { key: 'dark', label: 'Neon dark' },
          { key: 'light', label: 'Neon light' },
        ]}
      />
      <H2>Change password</H2>
      <Card>
        <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry />
        <Field label="New password (10+ characters)" value={next} onChangeText={setNext} secureTextEntry />
        {a.error ? <ErrorNote message={a.error} /> : null}
        {done ? <T>Password changed. Your other sessions were signed out.</T> : null}
        <Button
          title="Change password"
          icon="key-outline"
          onPress={() => void change()}
          busy={a.busy}
          disabled={!current || next.length < 10}
        />
      </Card>
      <Button title="Sign out" kind="secondary" icon="log-out-outline" onPress={() => void signOut()} />
    </Screen>
  );
}
