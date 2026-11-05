import { useState } from 'react';
import { router } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, Button, Card, Field, List, Row, Screen } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { Project } from '@/lib/types';

export default function Projects() {
  return (
    <Gate feature="projects">
      <ProjectList />
    </Gate>
  );
}

function ProjectList() {
  const q = useApi<Project[]>('/projects');
  const { api, member } = useSession();
  const [name, setName] = useState('');
  const a = useAction();
  const [filter, setFilter] = useState('');
  const canCreate = member?.role === 'ADMIN' || member?.role === 'PROGRAMMER';
  const create = () =>
    a.run(async () => {
      const p = await api.post<Project>('/projects', { name: name.trim() });
      setName('');
      await q.reload();
      router.push(`/project/${p.id}`);
    });
  const items = q.data?.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Field label="Search projects" value={filter} onChangeText={setFilter} placeholder="Name" />
      <Async q={q}>
        {() => (
          <List
            items={items}
            empty="No projects yet."
            render={(p) => (
              <Row
                testID={`project-${p.id}`}
                title={p.name}
                subtitle={`${p._count?.surveys ?? 0} surveys · ${p._count?.vendors ?? 0} vendors`}
                icon="folder-outline"
                onPress={() => router.push(`/project/${p.id}`)}
              />
            )}
          />
        )}
      </Async>
      {canCreate ? (
        <Card>
          <Field label="New project" value={name} onChangeText={setName} placeholder="e.g. Brand tracker W3" />
          {a.error ? <Row title={a.error} icon="alert-circle" /> : null}
          <Button title="Create project" icon="add" onPress={create} busy={a.busy} disabled={!name.trim()} />
        </Card>
      ) : null}
    </Screen>
  );
}
