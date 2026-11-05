import { useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, Button, Card, ErrorNote, Field, H2, List, Pill, Row, Screen, Segmented, T } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';

type Role = 'ADMIN' | 'PROGRAMMER' | 'VIEWER' | 'INTERVIEWER';
interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabledAt: string | null;
}
const ROLES: Array<{ key: Role; label: string }> = [
  { key: 'ADMIN', label: 'Admin' },
  { key: 'PROGRAMMER', label: 'Programmer' },
  { key: 'VIEWER', label: 'Viewer' },
  { key: 'INTERVIEWER', label: 'Interviewer' },
];

export default function Team() {
  return (
    <>
      <Stack.Screen options={{ title: 'Team' }} />
      <Gate feature="team">
        <TeamBody />
      </Gate>
    </>
  );
}

function TeamBody() {
  const { api, member: me } = useSession();
  const q = useApi<Member[]>('/users');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'VIEWER' as Role });
  const a = useAction();
  const update = (m: Member, body: Record<string, unknown>) =>
    a.run(async () => (await api.patch(`/users/${m.id}`, body), await q.reload()));
  const add = () =>
    a.run(async () => {
      await api.post('/users', form);
      setForm({ name: '', email: '', password: '', role: 'VIEWER' });
      await q.reload();
    });
  if (me?.role !== 'ADMIN')
    return (
      <Screen>
        <T muted>Only organization admins manage the team.</T>
      </Screen>
    );
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      {a.error ? <ErrorNote message={a.error} /> : null}
      <Async q={q}>
        {(list) => (
          <List
            items={list}
            empty="No members."
            render={(m) => (
              <View>
                <Row
                  title={m.name}
                  subtitle={m.email}
                  right={<Pill label={m.disabledAt ? 'disabled' : m.role} tone={m.disabledAt ? 'danger' : undefined} />}
                  onPress={m.id === me.id ? undefined : () => setOpen(open === m.id ? null : m.id)}
                />
                {open === m.id ? (
                  <View style={{ gap: 8, paddingBottom: 12 }}>
                    <Segmented value={m.role} onChange={(role) => void update(m, { role })} options={ROLES} />
                    <Button
                      small
                      kind={m.disabledAt ? 'secondary' : 'danger'}
                      title={m.disabledAt ? 'Enable sign-in' : 'Disable sign-in'}
                      onPress={() => void update(m, { disabled: !m.disabledAt })}
                    />
                  </View>
                ) : null}
              </View>
            )}
          />
        )}
      </Async>
      <H2>Add a member</H2>
      <Card>
        <Field label="Name" value={form.name} onChangeText={(name) => setForm({ ...form, name })} />
        <Field
          label="Email"
          value={form.email}
          onChangeText={(email) => setForm({ ...form, email })}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Field
          label="First password (10+ characters)"
          value={form.password}
          onChangeText={(password) => setForm({ ...form, password })}
          secureTextEntry
        />
        <Segmented value={form.role} onChange={(role) => setForm({ ...form, role })} options={ROLES} />
        <Button
          title="Add member"
          icon="person-add-outline"
          onPress={() => void add()}
          busy={a.busy}
          disabled={!form.name || !form.email || form.password.length < 10}
        />
      </Card>
    </Screen>
  );
}
