import { useState } from 'react';
import { Async, Button, ErrorNote, List, Pill, Row, Section, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { Frequency } from '@/lib/types';
import { FrequencyCard } from './analysis';

interface Report {
  id: string;
  name: string;
  config: { type: 'frequencies' | 'crosstab' | 'dashboard' };
  updatedAt: string;
}
interface Result {
  total: number;
  frequencies?: Frequency[];
  tiles?: Array<{ variable: string; label: string; frequency: Frequency }>;
  tables?: unknown[];
}

export function Reports({ surveyId }: { surveyId: string }) {
  const q = useApi<Report[]>(`/surveys/${surveyId}/reports`);
  const { api } = useSession();
  const [open, setOpen] = useState<{ id: string; result: Result } | null>(null);
  const a = useAction();
  const run = (r: Report) => a.run(async () => setOpen({ id: r.id, result: await api.post<Result>(`/reports/${r.id}/run`) }));
  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Async q={q}>
        {(list) => (
          <List
            items={list}
            empty="No saved reports. Save one from Analysis in the web app."
            render={(r) => (
              <Row
                title={r.name}
                subtitle={`Updated ${when(r.updatedAt)}`}
                right={<Pill label={r.config.type} tone="accent3" />}
                onPress={() => void run(r)}
              />
            )}
          />
        )}
      </Async>
      {a.busy ? <Button title="Running…" onPress={() => undefined} busy /> : null}
      {a.error ? <ErrorNote message={a.error} /> : null}
      {open?.result.frequencies?.map((f) => <FrequencyCard key={f.variable.id} f={f} />)}
      {open?.result.tiles?.map((t) => <FrequencyCard key={t.variable} f={t.frequency} />)}
      {open?.result.tables ? <ErrorNote message="Crosstab reports are best read in Analysis > Crosstab or the Excel export." /> : null}
    </Section>
  );
}
