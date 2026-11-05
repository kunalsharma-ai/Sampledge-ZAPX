import { Stack } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, Card, H2, KV, Screen, T, when } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Billing {
  enabled: boolean;
  plan: string;
  status: string | null;
  periodEnd: string | null;
}
interface Plan {
  plan: { code: string; name: string };
  limits?: Record<string, number | null>;
  usage?: Record<string, number>;
}

/** Organization settings readable on mobile: plan, billing state and limits. Changes stay on the web. */
export default function Organization() {
  return (
    <>
      <Stack.Screen options={{ title: 'Organization' }} />
      <Gate feature="settings">
        <OrgBody />
      </Gate>
    </>
  );
}

function OrgBody() {
  const billing = useApi<Billing>('/billing');
  const plan = useApi<Plan>('/plan');
  return (
    <Screen refreshing={billing.loading} onRefresh={billing.reload}>
      <Async q={billing}>
        {(b) => (
          <Card glow>
            <KV k="Plan" v={b.plan} />
            <KV k="Billing" v={b.enabled ? (b.status ?? 'no subscription') : 'not set up'} />
            {b.periodEnd ? <KV k="Renews" v={when(b.periodEnd)} /> : null}
          </Card>
        )}
      </Async>
      <H2>Limits and usage</H2>
      <Async q={plan}>
        {(p) => (
          <Card>
            {p.limits ? (
              Object.entries(p.limits).map(([k, v]) => (
                <KV key={k} k={k.replace(/([A-Z])/g, ' $1').toLowerCase()} v={`${p.usage?.[k] ?? '—'} / ${v ?? 'unlimited'}`} />
              ))
            ) : (
              <T muted>No limits.</T>
            )}
          </Card>
        )}
      </Async>
      <T muted size={12}>
        Plan changes and billing are managed on the web, or by the platform administrator.
      </T>
    </Screen>
  );
}
