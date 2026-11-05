import { router } from 'expo-router';
import { View } from 'react-native';
import { Async, Bar, Button, Card, Grid, H2, Hero, List, Pill, Row, Screen, Stat, T } from '@/components/ui';
import { Donut, TrendChart } from '@/components/charts';
import { Launcher } from '@/components/launcher';
import { useApi } from '@/lib/use-api';
import { useEntitlements } from '@/lib/entitlements-context';
import { useSession } from '@/lib/session';
import type { DashboardSummary } from '@/lib/types';

const MODE_LABEL = { CAWI: 'Online', CAPI: 'Face to face', CATI: 'Phone' } as const;

export default function Home() {
  const { has, value } = useEntitlements();
  const { member } = useSession();
  const q = useApi<DashboardSummary>(has('dashboard') ? '/dashboard' : null);
  const first = member?.name?.split(' ')[0];

  if (!has('dashboard')) {
    return (
      <Screen>
        <Hero
          title={`Welcome${first ? `, ${first}` : ''}`}
          subtitle={
            value.suspended
              ? 'This organization is suspended.'
              : value.surfaceAllowed === false
                ? 'The mobile app is turned off for you. Ask your platform administrator.'
                : 'Everything your plan includes on mobile.'
          }
        />
        <Launcher />
      </Screen>
    );
  }

  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Hero
        title="Build, program, test & launch surveys smarter with AI"
        subtitle={`Survey programming, QA, security and fieldwork for ${member?.tenant?.name ?? 'your team'}.`}
      >
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {has('projects') ? <Button title="Projects" icon="folder-open-outline" small onPress={() => router.push('/projects')} /> : null}
          {has('cati') ? (
            <Button title="Start calling" kind="secondary" icon="call-outline" small onPress={() => router.push('/calls')} />
          ) : null}
        </View>
      </Hero>
      <Async q={q}>
        {(d) => {
          const completes = d.responses.byStatus.COMPLETE ?? 0;
          const modes = (Object.keys(MODE_LABEL) as Array<keyof typeof MODE_LABEL>).map((m) => ({
            label: MODE_LABEL[m],
            value: d.responses.byMode[m],
          }));
          const devices = [
            { label: 'Mobile', value: d.responses.byDevice.mobile },
            { label: 'Desktop', value: d.responses.byDevice.desktop },
            { label: 'Tablet', value: d.responses.byDevice.tablet },
            { label: 'Unknown', value: d.responses.byDevice.unknown },
          ];
          const topCountry = Math.max(1, ...d.responses.topCountries.map((c) => c.count));
          return (
            <>
              <Grid>
                <Stat label="Projects" value={d.projects} icon="folder-open-outline" />
                <Stat
                  label="Live surveys"
                  value={d.surveys.byStatus.LIVE ?? 0}
                  icon="radio-outline"
                  tone={2}
                  hint={`${d.surveys.total} in total`}
                />
                <Stat label="Responses" value={d.responses.total} icon="people-outline" tone={1} />
                <Stat label="Completes" value={completes} icon="checkmark-done-outline" tone={2} />
                <Stat
                  label="QA passing"
                  value={`${d.qa.surveysPassing}/${d.qa.surveysTested}`}
                  icon="shield-checkmark-outline"
                  hint={`${d.qa.runs} runs`}
                />
                <Stat
                  label="Awaiting review"
                  value={d.responses.pendingReview}
                  icon="eye-outline"
                  tone={3}
                  hint={`${d.responses.rejectedInReview} rejected`}
                />
              </Grid>
              <H2>Survey performance</H2>
              <Card>
                <T muted size={12}>
                  Last {d.trend.length} days
                </T>
                <TrendChart points={d.trend} />
              </Card>
              <H2>Response overview</H2>
              <Card>
                <Donut slices={modes} center={d.responses.total.toLocaleString()} />
              </Card>
              <H2>Device distribution</H2>
              <Card>
                <Donut slices={devices} />
              </Card>
              {d.responses.topCountries.length ? (
                <>
                  <H2>Global reach</H2>
                  <Card>
                    <T muted size={12}>
                      {d.responses.countries} countries
                    </T>
                    {d.responses.topCountries.map((c) => (
                      <Bar key={c.code} label={c.code} value={c.count} max={topCountry} />
                    ))}
                  </Card>
                </>
              ) : null}
              <H2>Recent surveys</H2>
              <List
                items={d.recentSurveys}
                empty="No surveys yet."
                render={(s) => (
                  <Row
                    title={s.name}
                    subtitle={`${s.projectName} · ${s.completes.toLocaleString()} completes`}
                    right={<Pill label={s.status} />}
                    onPress={has('surveys.view') ? () => router.push(`/survey/${s.id}`) : undefined}
                  />
                )}
              />
            </>
          );
        }}
      </Async>
    </Screen>
  );
}
