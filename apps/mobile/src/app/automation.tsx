import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Stack } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, Button, Card, ErrorNote, Field, H2, List, Pill, Row, Screen, Segmented, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { usePalette } from '@/lib/theme';
import { RECIPES } from '@/lib/recipes';

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  surveyId: string | null;
  trigger: string;
  description: string;
  requiresApproval: boolean;
  lastFiredAt: string | null;
  runs: Record<string, number>;
}
interface Run {
  id: string;
  ruleName: string;
  summary: string;
  state: string;
  createdAt: string;
}
interface SurveyOption {
  id: string;
  name: string;
  project: string;
}

export default function Automation() {
  return (
    <>
      <Stack.Screen options={{ title: 'Automation' }} />
      <Gate feature="automation">
        <AutomationBody />
      </Gate>
    </>
  );
}

function AutomationBody() {
  const { api } = useSession();
  const p = usePalette();
  const rules = useApi<Rule[]>('/automation/rules');
  const runs = useApi<Run[] | { items: Run[] }>('/automation/runs');
  const surveys = useApi<SurveyOption[]>('/automation/surveys');
  const [recipe, setRecipe] = useState<(typeof RECIPES)[number]['key']>('quota_full');
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [n, setN] = useState('100');
  const a = useAction();
  const r = RECIPES.find((x) => x.key === recipe)!;
  const needsSurvey = recipe !== 'quota_full';
  const runList = Array.isArray(runs.data) ? runs.data : runs.data?.items;
  const waiting = runList?.filter((x) => x.state.toUpperCase() === 'AWAITING_APPROVAL');

  const create = () =>
    a.run(async () => {
      await api.post('/automation/rules', r.build(surveyId, Number(n)));
      await rules.reload();
    });
  const toggle = (rule: Rule) =>
    a.run(async () => (await api.patch(`/automation/rules/${rule.id}`, { enabled: !rule.enabled }), await rules.reload()));
  const decide = (run: Run, verb: 'approve' | 'reject') =>
    a.run(async () => (await api.post(`/automation/runs/${run.id}/${verb}`), await runs.reload()));

  return (
    <Screen
      refreshing={rules.loading}
      onRefresh={() => {
        void rules.reload();
        void runs.reload();
      }}
    >
      <Card glow>
        <T bold>Quick automation</T>
        <Segmented value={recipe} onChange={setRecipe} options={RECIPES.map((x) => ({ key: x.key, label: x.label }))} />
        <Async q={surveys}>
          {(list) => (
            <Segmented
              value={surveyId ?? ''}
              onChange={(v) => setSurveyId(v || null)}
              options={[
                ...(needsSurvey ? [] : [{ key: '', label: 'Every survey' }]),
                ...list.slice(0, 30).map((s) => ({ key: s.id, label: s.name })),
              ]}
            />
          )}
        </Async>
        {r.needsNumber ? <Field label={r.numberLabel} value={n} onChangeText={setN} keyboardType="number-pad" /> : null}
        {a.error ? <ErrorNote message={a.error} /> : null}
        <Button
          title="Turn it on"
          icon="flash-outline"
          onPress={() => void create()}
          busy={a.busy}
          disabled={(needsSurvey && !surveyId) || (r.needsNumber && !/^\d+$/.test(n))}
          testID="create-rule"
        />
      </Card>
      {waiting?.length ? (
        <>
          <H2>Waiting for your approval</H2>
          {waiting.map((run) => (
            <Card key={run.id}>
              <T bold>{run.ruleName}</T>
              <T muted>{run.summary}</T>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button small title="Approve" icon="checkmark" onPress={() => void decide(run, 'approve')} />
                <Button small kind="secondary" title="Reject" onPress={() => void decide(run, 'reject')} />
              </View>
            </Card>
          ))}
        </>
      ) : null}
      <H2>Rules</H2>
      <Async q={rules}>
        {(list) => (
          <List
            items={list}
            empty="No rules yet."
            render={(rule) => (
              <Row
                title={rule.name}
                subtitle={`${rule.description}${rule.lastFiredAt ? `\nLast fired ${when(rule.lastFiredAt)}` : ''}`}
                right={
                  <Switch
                    accessibilityLabel={`${rule.name} on`}
                    value={rule.enabled}
                    onValueChange={() => void toggle(rule)}
                    trackColor={{ true: p.accent, false: p.surface2 }}
                    thumbColor={p.onAccent}
                  />
                }
              />
            )}
          />
        )}
      </Async>
      <H2>Recent runs</H2>
      <List
        items={runList?.slice(0, 30)}
        empty="No runs yet."
        render={(run) => (
          <Row title={run.ruleName} subtitle={`${run.summary}\n${when(run.createdAt)}`} right={<Pill label={run.state} />} />
        )}
      />
    </Screen>
  );
}
