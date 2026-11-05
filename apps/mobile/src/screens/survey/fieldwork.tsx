import { Async, Card, Grid, H2, KV, List, Pill, Row, Section, Stat } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Dashboard {
  totals: {
    interviews: number;
    completes: number;
    target: number | null;
    exceptions: number;
    openAppeals: number;
    pendingBackChecks: number;
  };
  interviewers: Array<{
    id: string;
    name: string;
    active: boolean;
    interviews: number;
    completes: number;
    target: number | null;
    averageQuality: number | null;
    exceptions: number;
    lastSyncAt: string | null;
  }>;
  exceptions: Array<{
    responseId: string;
    uid: string;
    interviewer: string | null;
    status: string;
    flags: Array<{ code: string; detail: string }>;
  }>;
}
interface Appeal {
  id: string;
  uid: string | null;
  message: string | null;
  state: string;
  raisedBy: string | null;
}

/** Supervisor view: interviewer progress, exceptions and open appeals. */
export function Fieldwork({ surveyId }: { surveyId: string }) {
  const q = useApi<Dashboard>(`/surveys/${surveyId}/supervisor`);
  const appeals = useApi<Appeal[]>(`/surveys/${surveyId}/appeals`);
  return (
    <Section
      refreshing={q.loading}
      onRefresh={() => {
        void q.reload();
        void appeals.reload();
      }}
    >
      <Async q={q}>
        {(d) => (
          <>
            <Grid>
              <Stat label="Interviews" value={d.totals.interviews} icon="people-outline" />
              <Stat
                label="Completes"
                value={d.totals.completes}
                icon="checkmark-done-outline"
                tone={2}
                hint={d.totals.target ? `target ${d.totals.target}` : undefined}
              />
              <Stat label="Exceptions" value={d.totals.exceptions} icon="warning-outline" tone={1} />
              <Stat label="Back-checks due" value={d.totals.pendingBackChecks} icon="call-outline" tone={3} />
            </Grid>
            <H2>Interviewers</H2>
            <List
              items={d.interviewers}
              empty="No interviewers on this survey."
              render={(i) => (
                <Row
                  title={i.name}
                  subtitle={`${i.completes}${i.target ? `/${i.target}` : ''} completes · ${i.interviews} interviews · quality ${i.averageQuality ?? '—'}`}
                  right={<Pill label={i.active ? 'active' : 'inactive'} tone={i.active ? 'success' : 'muted'} />}
                />
              )}
            />
            <H2>Exceptions</H2>
            <List
              items={d.exceptions.slice(0, 30)}
              empty="No exceptions."
              render={(e) => (
                <Row
                  title={e.uid}
                  subtitle={`${e.interviewer ?? '—'} · ${e.flags.map((f) => f.detail).join('; ')}`}
                  right={<Pill label={e.status} />}
                />
              )}
            />
          </>
        )}
      </Async>
      <H2>Appeals</H2>
      <Async q={appeals}>
        {(list) => (
          <Card>
            {list.length ? (
              list.map((ap) => (
                <Row
                  key={ap.id}
                  title={`${ap.uid ?? ap.id.slice(0, 8)} · ${ap.raisedBy ?? ''}`}
                  subtitle={ap.message ?? ''}
                  right={<Pill label={ap.state} />}
                />
              ))
            ) : (
              <KV k="Appeals" v="none" />
            )}
          </Card>
        )}
      </Async>
    </Section>
  );
}
