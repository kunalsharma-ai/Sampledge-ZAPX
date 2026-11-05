import { useState } from 'react';
import { Stack } from 'expo-router';
import { Async, Button, Card, ErrorNote, KV, Pill, Screen, T } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';

interface Integration {
  key: string;
  name: string;
  category: string;
  purpose: string;
  enabled: boolean;
  switchedOn: boolean;
  source: string;
  warning: string | null;
}

/**
 * Platform integrations (Claude, IPinfo, Deepgram, Twilio, Stripe, S3) for the super admin and the
 * operator organization's admins: status, and a connection test. Keys are entered on the web, where
 * they never leave the server; the phone only sees whether each one works.
 */
export default function Platform() {
  const { api, member } = useSession();
  const allowed = member?.canManageIntegrations || member?.superAdmin;
  const q = useApi<{ integrations: Integration[] }>(allowed ? '/platform/integrations' : null);
  const [tested, setTested] = useState<Record<string, string>>({});
  const a = useAction();
  const test = (i: Integration) =>
    a.run(async () => {
      const r = await api.post<{ ok: boolean; message?: string; detail?: string }>(`/platform/integrations/${i.key}/test`, { values: {} });
      setTested((t) => ({ ...t, [i.key]: `${r.ok ? 'Works' : 'Failed'}${r.message || r.detail ? `: ${r.message ?? r.detail}` : ''}` }));
    });
  if (!allowed)
    return (
      <Screen>
        <T muted>Only the platform administrator manages integrations.</T>
      </Screen>
    );
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Stack.Screen options={{ title: 'Platform integrations' }} />
      {a.error ? <ErrorNote message={a.error} /> : null}
      <Async q={q}>
        {(d) => (
          <>
            {d.integrations.map((i) => (
              <Card key={i.key}>
                <KV k={i.name} v={<Pill label={i.enabled ? 'on' : 'off'} tone={i.enabled ? 'success' : 'muted'} />} />
                <T muted size={13}>
                  {i.purpose}
                </T>
                <T muted size={12}>
                  Settings from: {i.source}
                </T>
                {i.warning ? <T size={12}>{i.warning}</T> : null}
                {tested[i.key] ? <T bold>{tested[i.key]}</T> : null}
                {i.enabled ? (
                  <Button small kind="secondary" title="Test connection" icon="pulse-outline" onPress={() => void test(i)} />
                ) : null}
              </Card>
            ))}
            <T muted size={12}>
              Add or change keys in the web app under Settings, Integrations.
            </T>
          </>
        )}
      </Async>
    </Screen>
  );
}
