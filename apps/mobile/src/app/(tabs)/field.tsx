import { router } from 'expo-router';
import { Async, Card, H2, List, Pill, Row, Screen, T } from '@/components/ui';
import { useEntitlements } from '@/lib/entitlements-context';
import { useAllSurveys } from '@/lib/use-surveys';

/** Fieldwork hub: take calls, run face-to-face interviews, and supervise or review a survey. */
export default function Field() {
  const { has } = useEntitlements();
  const supervise = has('fieldwork') || has('review_queue');
  const q = useAllSurveys(supervise && has('projects'));
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      {has('cati') || has('capi') ? (
        <Card style={{ paddingVertical: 4, gap: 0 }}>
          {has('cati') ? (
            <Row
              testID="field-calls"
              title="Calling"
              subtitle="Take the next call and record its outcome"
              icon="call-outline"
              onPress={() => router.push('/calls')}
            />
          ) : null}
          {has('capi') ? (
            <Row
              testID="field-capi"
              title="Face-to-face interviews"
              subtitle="CAPI interviewing, also offline"
              icon="tablet-portrait-outline"
              onPress={() => router.push('/capi')}
            />
          ) : null}
        </Card>
      ) : null}
      {supervise ? (
        <>
          <H2 help="h.superviseSurvey">Supervise a survey</H2>
          {!has('projects') ? (
            <T muted>Your plan does not include Projects, so surveys cannot be listed here.</T>
          ) : (
            <Async q={q}>
              {(list) => (
                <List
                  items={list}
                  empty="No surveys yet."
                  render={(s) => (
                    <Row
                      title={s.name}
                      subtitle={s.projectName}
                      right={<Pill label={s.status} />}
                      onPress={() =>
                        router.push({ pathname: '/survey/[id]', params: { id: s.id, tab: has('fieldwork') ? 'fieldwork' : 'review' } })
                      }
                    />
                  )}
                />
              )}
            </Async>
          )}
        </>
      ) : null}
    </Screen>
  );
}
