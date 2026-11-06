import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Gate } from '@/components/gate';
import { Async, Button, Card, Empty, ErrorNote, Field, H2, KV, List, Pill, Row, Screen, Segmented, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { useFeature } from '@/lib/entitlements-context';

interface CallSurvey {
  id: string;
  name: string;
  dueNow: number;
  mine: number;
}
interface Case {
  id: string;
  code: string;
  name: string | null;
  phone: string | null;
  phoneHint: string;
  data: Record<string, string>;
  attempts: number;
  maxAttempts: number;
  lastDisposition: string | null;
  calls: Array<{ disposition: string; note: string | null; endedAt: string }>;
  dialer: { record: boolean } | null;
}
interface Dial {
  id: string;
  status: string;
  error: string | null;
}

const CALLBACK = [
  { key: '1', label: 'In 1 hour', at: () => new Date(Date.now() + 3_600_000) },
  { key: '3', label: 'In 3 hours', at: () => new Date(Date.now() + 3 * 3_600_000) },
  {
    key: 'tomorrow',
    label: 'Tomorrow 10:00',
    at: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      return d;
    },
  },
] as const;

/** CATI interviewer: take the next due case, call, run the interview and record the outcome. */
export default function Calls() {
  return (
    <>
      <Stack.Screen options={{ title: 'Calling' }} />
      <Gate feature="cati">
        <CallDesk />
      </Gate>
    </>
  );
}

function CallDesk() {
  const { api } = useSession();
  const hasDialer = useFeature('calls');
  const surveys = useApi<CallSurvey[]>('/cati/surveys');
  const dispositions = useApi<Array<{ code: string; label: string }>>('/cati/dispositions');
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Case | null>(null);
  const [openedAt, setOpenedAt] = useState('');
  const [disposition, setDisposition] = useState('no_answer');
  const [callback, setCallback] = useState<(typeof CALLBACK)[number]['key']>('1');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [dial, setDial] = useState<Dial | null>(null);
  const a = useAction();

  useEffect(() => {
    if (!dial || !current || !['queued', 'initiated', 'ringing', 'in-progress'].includes(dial.status)) return;
    const t = setInterval(() => void api.get<{ dial: Dial | null }>(`/cati/cases/${current.id}/dial`).then((r) => setDial(r.dial)), 2000);
    return () => clearInterval(t);
  }, [api, dial, current]);

  const next = (id: string) =>
    a.run(async () => {
      setSurveyId(id);
      setMessage(null);
      const { case: c } = await api.post<{ case: Case | null }>(`/cati/surveys/${id}/next`);
      setCurrent(c);
      setEmpty(!c);
      setDial(null);
      setOpenedAt(new Date().toISOString());
    });
  const startInterview = () =>
    a.run(async () => {
      if (!current) return;
      const { runtimeUrl } = await api.post<{ runtimeUrl: string }>(`/cati/cases/${current.id}/interview`);
      await WebBrowser.openBrowserAsync(runtimeUrl);
    });
  const placeDial = () => a.run(async () => current && setDial(await api.post<Dial>(`/cati/cases/${current.id}/dial`)));
  const save = () =>
    a.run(async () => {
      if (!current || !surveyId) return;
      const body: Record<string, unknown> = { disposition, openedAt, ...(note.trim() ? { note: note.trim() } : {}) };
      if (disposition === 'callback')
        body.callbackAt = CALLBACK.find((c) => c.key === callback)!
          .at()
          .toISOString();
      const r = await api.post<{ status: string; lastDisposition: string }>(`/cati/cases/${current.id}/disposition`, body);
      setMessage(`Saved: ${r.lastDisposition.replace(/_/g, ' ')} (${r.status.toLowerCase()}).`);
      setCurrent(null);
      setNote('');
      await surveys.reload();
    });
  const release = () =>
    a.run(async () => {
      if (!current) return;
      await api.post(`/cati/cases/${current.id}/release`);
      setCurrent(null);
    });

  if (current) {
    return (
      <Screen>
        <Card glow>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T bold size={18}>
              {current.name ?? current.code}
            </T>
            <Pill label={`attempt ${current.attempts + 1}/${current.maxAttempts}`} tone="accent3" />
          </View>
          {Object.entries(current.data)
            .slice(0, 8)
            .map(([k, v]) => (
              <KV key={k} k={k} v={v} />
            ))}
          {current.dialer && !hasDialer ? (
            <T muted>This survey places calls through the dialer, which is not in your mobile plan.</T>
          ) : current.dialer ? (
            <>
              <T muted>
                Numbers are hidden for this survey: SampCode rings your phone and then connects the respondent
                {current.dialer.record ? ' (the call is recorded)' : ''}.
              </T>
              <Button
                title={dial ? `Call ${dial.status}` : 'Call through the dialer'}
                icon="call"
                onPress={() => void placeDial()}
                busy={a.busy}
              />
              {dial?.error ? <ErrorNote message={dial.error} /> : null}
            </>
          ) : current.phone ? (
            <Button
              title={`Call ${current.phone}`}
              icon="call"
              onPress={() => void Linking.openURL(`tel:${current.phone}`)}
              testID="call-number"
            />
          ) : (
            <T muted>{current.phoneHint}</T>
          )}
          <Button title="Open the interview" kind="secondary" icon="document-text-outline" onPress={() => void startInterview()} />
        </Card>
        {current.calls.length ? (
          <>
            <H2>Earlier calls</H2>
            <List
              items={current.calls}
              empty=""
              render={(c) => (
                <Row title={c.disposition.replace(/_/g, ' ')} subtitle={`${when(c.endedAt)}${c.note ? ` · ${c.note}` : ''}`} />
              )}
            />
          </>
        ) : null}
        <H2 help="h.outcome">Outcome</H2>
        <Card>
          <Async q={dispositions}>
            {(list) => (
              <Segmented value={disposition} onChange={setDisposition} options={list.map((d) => ({ key: d.code, label: d.label }))} />
            )}
          </Async>
          {disposition === 'callback' ? (
            <Segmented value={callback} onChange={setCallback} options={CALLBACK.map((c) => ({ key: c.key, label: c.label }))} />
          ) : null}
          <Field label="Note" value={note} onChangeText={setNote} />
          {a.error ? <ErrorNote message={a.error} /> : null}
          <Button title="Save outcome" icon="save-outline" onPress={() => void save()} busy={a.busy} testID="save-outcome" />
          <Button title="Put back in the queue" kind="ghost" onPress={() => void release()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen refreshing={surveys.loading} onRefresh={surveys.reload}>
      {message ? <T>{message}</T> : null}
      {empty ? <Empty text="No calls are due for this survey right now." icon="cafe-outline" /> : null}
      {a.error ? <ErrorNote message={a.error} /> : null}
      <Async q={surveys}>
        {(list) => (
          <List
            items={list}
            empty="No surveys are assigned to you for calling."
            render={(s) => (
              <Row
                testID={`call-survey-${s.id}`}
                title={s.name}
                subtitle={`${s.dueNow} due now · ${s.mine} mine`}
                icon="call-outline"
                onPress={() => void next(s.id)}
              />
            )}
          />
        )}
      </Async>
    </Screen>
  );
}
