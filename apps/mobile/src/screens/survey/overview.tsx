import { useState } from 'react';
import { Alert, Platform, Share, View } from 'react-native';
import { IfFeature } from '@/components/gate';
import { Async, Button, Card, ErrorNote, Grid, H2, KV, List, Pill, Row, Section, Stat, T, when } from '@/components/ui';
import { useAction } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { SurveyDetail } from '@/lib/types';

type Q = { data: SurveyDetail | undefined; error: { message: string } | null; loading: boolean; reload: () => Promise<void> | void };

function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? true);
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ]),
  );
}

export function Overview({ survey: q }: { survey: Q }) {
  const { api } = useSession();
  const a = useAction();
  const [link, setLink] = useState<string | null>(null);

  const publish = (s: SurveyDetail) =>
    a.run(async () => {
      if (!(await confirm('Publish survey', 'Respondents will get the current draft. Continue?'))) return;
      await api.post(`/surveys/${s.id}/publish`);
      await q.reload();
    });
  const setStatus = (s: SurveyDetail, status: 'LIVE' | 'PAUSED' | 'CLOSED') =>
    a.run(async () => {
      if (status === 'CLOSED' && !(await confirm('Close survey', 'Closed surveys stop accepting respondents.'))) return;
      await api.post(`/surveys/${s.id}/status`, { status });
      await q.reload();
    });
  const testLink = (s: SurveyDetail) =>
    a.run(async () => {
      const r = await api.post<{ url: string }>(`/surveys/${s.id}/links`, { test: true });
      setLink(r.url);
      await Share.share({ message: r.url }).catch(() => undefined);
    });

  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Async q={q}>
        {(s) => {
          const c = s.responseCounts;
          const live = s.versions.find((v) => v.status === 'PUBLISHED' || v.publishedAt);
          return (
            <>
              <Card glow>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <T bold size={18}>
                    {s.name}
                  </T>
                  <Pill label={s.status} />
                </View>
                <KV k="Latest version" v={`v${s.versions[0]?.version ?? 1} (${(s.versions[0]?.status ?? '').toLowerCase()})`} />
                <KV k="Published" v={live ? when(live.publishedAt) : 'never'} />
                <KV k="Updated" v={when(s.updatedAt)} />
              </Card>
              <Grid>
                <Stat label="Completes" value={c.COMPLETE ?? 0} icon="checkmark-done-outline" tone={2} />
                <Stat label="In progress" value={c.IN_PROGRESS ?? 0} icon="time-outline" />
                <Stat label="Terminates" value={c.TERMINATE ?? 0} icon="close-circle-outline" tone={1} />
                <Stat label="Quota full" value={c.QUOTA_FULL ?? 0} icon="pie-chart-outline" tone={3} />
              </Grid>
              {a.error ? <ErrorNote message={a.error} /> : null}
              <IfFeature feature="surveys.publish">
                <H2>Launch control</H2>
                <Card>
                  <Button title="Publish draft" icon="rocket-outline" onPress={() => void publish(s)} busy={a.busy} testID="publish" />
                  <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                    {s.status !== 'LIVE' && s.status !== 'DRAFT' ? (
                      <Button small kind="secondary" title="Resume" icon="play" onPress={() => void setStatus(s, 'LIVE')} />
                    ) : null}
                    {s.status === 'LIVE' ? (
                      <Button
                        small
                        kind="secondary"
                        title="Pause"
                        icon="pause"
                        onPress={() => void setStatus(s, 'PAUSED')}
                        testID="pause"
                      />
                    ) : null}
                    {s.status === 'LIVE' || s.status === 'PAUSED' ? (
                      <Button small kind="danger" title="Close" icon="stop" onPress={() => void setStatus(s, 'CLOSED')} />
                    ) : null}
                  </View>
                </Card>
              </IfFeature>
              <IfFeature feature="distribution">
                <Button title="Share a test link" kind="secondary" icon="link-outline" onPress={() => void testLink(s)} />
                {link ? (
                  <T muted size={12}>
                    {link}
                  </T>
                ) : null}
              </IfFeature>
              <H2>Versions</H2>
              <List
                items={s.versions}
                empty="No versions."
                render={(v) => (
                  <Row title={`Version ${v.version}`} subtitle={`Created ${when(v.createdAt)}`} right={<Pill label={v.status} />} />
                )}
              />
            </>
          );
        }}
      </Async>
    </Section>
  );
}
