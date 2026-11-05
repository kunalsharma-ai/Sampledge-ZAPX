import { useState } from 'react';
import { View } from 'react-native';
import { Async, Button, Card, ErrorNote, Grid, H2, KV, List, Pill, Row, Section, Segmented, Stat, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';

interface RunSummary {
  id: string;
  version: number;
  respondents: number;
  passed: boolean;
  coverage: number;
  createdAt: string;
}
interface Defect {
  severity: 'error' | 'warning';
  code: string;
  message?: string;
  detail?: string;
  location?: string;
}
interface RunResult {
  id: string;
  version: number;
  report: {
    passed: boolean;
    respondents: number;
    uniquePaths: number;
    coverage: { percent: number };
    outcomes: Record<string, number>;
    defects: Defect[];
  };
}

export function QaLab({ surveyId }: { surveyId: string }) {
  const runs = useApi<RunSummary[]>(`/surveys/${surveyId}/qa/runs`);
  const { api } = useSession();
  const [target, setTarget] = useState<'draft' | 'live'>('draft');
  const [result, setResult] = useState<RunResult | null>(null);
  const a = useAction();
  const run = () =>
    a.run(async () => {
      setResult(await api.post<RunResult>(`/surveys/${surveyId}/qa/run`, { respondents: 500, target }));
      await runs.reload();
    });
  return (
    <Section refreshing={runs.loading} onRefresh={runs.reload}>
      <Card glow>
        <T>Simulate 500 synthetic respondents through the survey with the live logic engine. Runs never touch real data or quotas.</T>
        <Segmented
          value={target}
          options={[
            { key: 'draft', label: 'Test the draft' },
            { key: 'live', label: 'Test the live version' },
          ]}
          onChange={setTarget}
        />
        <Button title="Run QA" icon="flask-outline" onPress={() => void run()} busy={a.busy} testID="run-qa" />
        {a.error ? <ErrorNote message={a.error} /> : null}
      </Card>
      {result ? (
        <>
          <Grid>
            <Stat
              label="Result"
              value={result.report.passed ? 'Passed' : 'Failed'}
              icon={result.report.passed ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              tone={result.report.passed ? 2 : 1}
            />
            <Stat label="Coverage" value={`${result.report.coverage.percent}%`} icon="analytics-outline" />
            <Stat label="Unique paths" value={result.report.uniquePaths} icon="git-branch-outline" tone={3} />
          </Grid>
          <Card>
            {Object.entries(result.report.outcomes).map(([k, v]) => (
              <KV key={k} k={k.replace(/_/g, ' ').toLowerCase()} v={v} />
            ))}
          </Card>
          <H2>Defects</H2>
          <List
            items={result.report.defects}
            empty="No defects found."
            render={(d) => (
              <Row
                title={d.message ?? d.detail ?? d.code}
                subtitle={d.location ?? d.code}
                right={<Pill label={d.severity} tone={d.severity === 'error' ? 'danger' : 'warning'} />}
              />
            )}
          />
        </>
      ) : null}
      <H2>Earlier runs</H2>
      <Async q={runs}>
        {(list) => (
          <List
            items={list}
            empty="No QA runs yet."
            render={(r) => (
              <Row
                title={`v${r.version} · ${r.respondents} respondents`}
                subtitle={`${when(r.createdAt)} · coverage ${r.coverage}%`}
                right={
                  <View>
                    <Pill label={r.passed ? 'passed' : 'failed'} />
                  </View>
                }
              />
            )}
          />
        )}
      </Async>
    </Section>
  );
}
