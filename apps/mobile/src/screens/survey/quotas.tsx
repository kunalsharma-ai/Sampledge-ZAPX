import { useState } from 'react';
import { View } from 'react-native';
import { useEntitlements } from '@/lib/entitlements-context';
import { Async, Bar, Button, Card, Empty, ErrorNote, Field, KV, Section, T } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { Quota } from '@/lib/types';

export function Quotas({ surveyId }: { surveyId: string }) {
  const q = useApi<Quota[]>(`/surveys/${surveyId}/quotas`);
  const { has } = useEntitlements();
  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Async q={q}>
        {(list) =>
          list.length ? (
            list.map((quota) => (
              <QuotaCard key={quota.id} surveyId={surveyId} quota={quota} editable={has('surveys.publish')} onSaved={q.reload} />
            ))
          ) : (
            <Empty text="No quotas in the live version (publish the survey first)." icon="pie-chart-outline" />
          )
        }
      </Async>
    </Section>
  );
}

function QuotaCard({ surveyId, quota, editable, onSaved }: { surveyId: string; quota: Quota; editable: boolean; onSaved: () => void }) {
  const { api } = useSession();
  const [target, setTarget] = useState(String(quota.target));
  const a = useAction();
  const save = (value: number | null) =>
    a.run(async () => {
      await api.put(`/surveys/${surveyId}/quotas/${quota.id}`, { target: value });
      onSaved();
    });
  const full = quota.count >= quota.target;
  return (
    <Card>
      <Bar label={quota.label} value={quota.count} max={quota.target} />
      <KV k="Target" v={`${quota.target.toLocaleString()}${quota.overridden ? ` (published ${quota.publishedTarget})` : ''}`} />
      {full ? <T muted>Full: new respondents in this cell are screened out.</T> : null}
      {editable ? (
        <View style={{ gap: 8 }}>
          <Field label="Change target live" value={target} onChangeText={setTarget} keyboardType="number-pad" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small title="Save" onPress={() => void save(Number(target))} busy={a.busy} disabled={!/^\d+$/.test(target)} />
            {quota.overridden ? <Button small kind="secondary" title="Reset" onPress={() => void save(null)} /> : null}
          </View>
          {a.error ? <ErrorNote message={a.error} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
