import { Async, Card, Grid, H2, KV, List, Pill, Row, Section, Stat, T, when } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Summary {
  cases: Partial<Record<'PENDING' | 'CALLBACK' | 'IN_CALL' | 'DONE' | 'CLOSED', number>>;
  dueNow: number;
  dispositions: Record<string, number>;
  callsLast24h: Array<{ interviewer: string; calls: number }>;
  doNotCall: number;
  callingHours: { timeZone: string; from: string; until: string; days: number[] } | null;
  withinHoursNow: boolean;
}
interface CaseRow {
  id: string;
  code: string;
  name: string | null;
  phoneHint: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextCallAt: string;
  lastDisposition: string | null;
}

/** CATI progress for the survey: the call list, outcomes and calling hours. */
export function CatiSetup({ surveyId }: { surveyId: string }) {
  const s = useApi<Summary>(`/surveys/${surveyId}/cati/summary`);
  const cases = useApi<CaseRow[] | { items: CaseRow[] }>(`/surveys/${surveyId}/cati/cases`);
  const rows = Array.isArray(cases.data) ? cases.data : cases.data?.items;
  return (
    <Section
      refreshing={s.loading}
      onRefresh={() => {
        void s.reload();
        void cases.reload();
      }}
    >
      <Async q={s}>
        {(d) => (
          <>
            <Grid>
              <Stat label="Due now" value={d.dueNow} icon="call-outline" tone={2} />
              <Stat label="Pending" value={d.cases.PENDING ?? 0} icon="time-outline" />
              <Stat label="Callbacks" value={d.cases.CALLBACK ?? 0} icon="repeat-outline" tone={3} />
              <Stat label="Done" value={d.cases.DONE ?? 0} icon="checkmark-done-outline" tone={1} />
            </Grid>
            <Card>
              <KV
                k="Calling hours"
                v={d.callingHours ? `${d.callingHours.from}–${d.callingHours.until} ${d.callingHours.timeZone}` : 'any time'}
              />
              <KV k="Within hours now" v={d.withinHoursNow ? 'yes' : 'no'} />
              <KV k="Do-not-call list" v={d.doNotCall.toLocaleString()} />
            </Card>
            <H2>Outcomes</H2>
            <Card>
              {Object.keys(d.dispositions).length ? (
                Object.entries(d.dispositions).map(([k, v]) => <KV key={k} k={k.replace(/_/g, ' ')} v={v} />)
              ) : (
                <T muted>No calls yet.</T>
              )}
            </Card>
            <H2>Calls in the last 24 hours</H2>
            <List
              items={d.callsLast24h}
              empty="No calls."
              render={(c) => <Row title={c.interviewer} right={<Pill label={`${c.calls}`} tone="accent3" />} />}
            />
          </>
        )}
      </Async>
      <H2>Call list</H2>
      <List
        items={rows?.slice(0, 100)}
        empty="No cases. Upload a call list on the web."
        render={(c) => (
          <Row
            title={`${c.code}${c.name ? ` · ${c.name}` : ''}`}
            subtitle={`${c.phoneHint} · ${c.attempts}/${c.maxAttempts} attempts · next ${when(c.nextCallAt)}${c.lastDisposition ? ` · ${c.lastDisposition}` : ''}`}
            right={<Pill label={c.status} />}
          />
        )}
      />
    </Section>
  );
}
