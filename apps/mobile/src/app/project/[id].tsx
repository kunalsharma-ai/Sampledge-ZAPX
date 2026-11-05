import { useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, Button, Card, ErrorNote, Field, H2, List, Pill, Row, Screen, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useEntitlements } from '@/lib/entitlements-context';
import type { ProjectDetail, SurveyRow } from '@/lib/types';

export default function ProjectScreen() {
  return (
    <Gate feature="projects">
      <ProjectBody />
    </Gate>
  );
}

function ProjectBody() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useApi<ProjectDetail>(`/projects/${id}`);
  const { api, member } = useSession();
  const { has } = useEntitlements();
  const [name, setName] = useState('');
  const a = useAction();
  const canEdit = has('surveys.edit') && (member?.role === 'ADMIN' || member?.role === 'PROGRAMMER');
  const create = () =>
    a.run(async () => {
      const s = await api.post<SurveyRow>(`/projects/${id}/surveys`, { name: name.trim() });
      setName('');
      router.push(`/survey/${s.id}`);
    });
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Stack.Screen options={{ title: q.data?.name ?? 'Project' }} />
      <Async q={q}>
        {(p) => (
          <>
            <H2>Surveys</H2>
            <List
              items={p.surveys}
              empty="No surveys in this project yet."
              render={(s) => (
                <Row
                  testID={`survey-${s.id}`}
                  title={s.name}
                  subtitle={`Updated ${when(s.updatedAt)}`}
                  right={<Pill label={s.status} />}
                  onPress={has('surveys.view') ? () => router.push(`/survey/${s.id}`) : undefined}
                />
              )}
            />
            {canEdit ? (
              <Card>
                <Field label="New survey" value={name} onChangeText={setName} placeholder="Survey name" />
                {a.error ? <ErrorNote message={a.error} /> : null}
                <Button title="Create survey" icon="add" onPress={create} busy={a.busy} disabled={!name.trim()} />
              </Card>
            ) : null}
            {has('integrations') ? (
              <>
                <H2>Vendors</H2>
                <List
                  items={p.vendors}
                  empty="No vendors."
                  render={(v) => (
                    <Row title={v.name} subtitle={`${v.code} · ${v.integration ?? v.redirectMode}`} icon="swap-horizontal-outline" />
                  )}
                />
              </>
            ) : null}
          </>
        )}
      </Async>
    </Screen>
  );
}
