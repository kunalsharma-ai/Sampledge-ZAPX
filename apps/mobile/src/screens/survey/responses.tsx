import { useState } from 'react';
import { Async, List, Pill, Row, Section, Segmented, when } from '@/components/ui';
import { useApi } from '@/lib/use-api';
import type { ResponseRow } from '@/lib/types';

const MODE = { CAWI: 'online', CAPI: 'face to face', CATI: 'phone' } as const;
const dur = (ms: number | null) => (ms === null ? '' : ` · ${Math.round(ms / 60000)} min`);

export function Responses({ surveyId }: { surveyId: string }) {
  const [test, setTest] = useState<'real' | 'all'>('real');
  const q = useApi<ResponseRow[]>(`/surveys/${surveyId}/responses?take=200${test === 'all' ? '&includeTest=true' : ''}`);
  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Segmented
        value={test}
        options={[
          { key: 'real', label: 'Real' },
          { key: 'all', label: 'Include tests' },
        ]}
        onChange={setTest}
      />
      <Async q={q}>
        {(rows) => (
          <List
            items={rows}
            empty="No responses yet."
            render={(r) => (
              <Row
                title={r.uid ?? r.id.slice(0, 10)}
                subtitle={`${MODE[r.mode]}${r.vendor ? ` · ${r.vendor.code}` : ''}${r.interviewer ? ` · ${r.interviewer.name}` : ''}${r.country ? ` · ${r.country}` : ''}${dur(r.durationMs)}\n${when(r.startedAt)}${r.qualityScore !== null ? ` · quality ${r.qualityScore}` : ''}`}
                right={<Pill label={r.isTest ? 'test' : r.status} />}
              />
            )}
          />
        )}
      </Async>
    </Section>
  );
}
