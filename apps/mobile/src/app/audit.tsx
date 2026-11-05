import { Stack } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, List, Row, Screen, when } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Event {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  actor: { name: string; email: string | null } | null;
}

export default function Audit() {
  return (
    <>
      <Stack.Screen options={{ title: 'Audit log' }} />
      <Gate feature="audit_log">
        <AuditBody />
      </Gate>
    </>
  );
}

function AuditBody() {
  const q = useApi<{ items: Event[] }>('/audit?take=100');
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Async q={q}>
        {(d) => (
          <List
            items={d.items}
            empty="No events."
            render={(e) => (
              <Row
                title={e.action}
                subtitle={`${e.actor?.name ?? 'System'} · ${e.entityType} ${e.entityId.slice(0, 10)}\n${when(e.createdAt)}`}
                icon="receipt-outline"
              />
            )}
          />
        )}
      </Async>
    </Screen>
  );
}
