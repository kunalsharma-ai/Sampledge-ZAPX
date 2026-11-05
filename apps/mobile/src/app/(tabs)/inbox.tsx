import { router } from 'expo-router';
import { mobileHref } from '@/lib/links';
import { Gate } from '@/components/gate';
import { Async, Button, List, Pill, Row, Screen, when } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { Notification } from '@/lib/types';

export default function Inbox() {
  return (
    <Gate feature="notifications">
      <Notifications />
    </Gate>
  );
}

function Notifications() {
  const q = useApi<{ unread: number; items: Notification[] }>('/notifications');
  const { api } = useSession();
  const open = async (n: Notification) => {
    if (!n.read) await api.post(`/notifications/${n.id}/read`).catch(() => undefined);
    const href = mobileHref(n.link);
    if (href) router.push(href);
    else void q.reload();
  };
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Async q={q}>
        {(d) => (
          <>
            {d.unread ? (
              <Button
                title={`Mark all ${d.unread} as read`}
                kind="secondary"
                icon="checkmark-done"
                onPress={() => void api.post('/notifications/read-all').then(q.reload)}
              />
            ) : null}
            <List
              items={d.items}
              empty="No notifications."
              render={(n) => (
                <Row
                  title={n.title}
                  subtitle={`${n.body}\n${when(n.createdAt)}`}
                  icon={n.read ? 'mail-open-outline' : 'mail-unread-outline'}
                  right={n.read ? undefined : <Pill label="new" tone="accent3" />}
                  onPress={() => void open(n)}
                />
              )}
            />
          </>
        )}
      </Async>
    </Screen>
  );
}
