import { useState } from 'react';
import { View } from 'react-native';
import { Async, Button, Card, ErrorNote, Field, H2, KV, List, Pill, Row, Section, Segmented, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';

interface Wave {
  id: string;
  name: string;
  channel: 'email' | 'sms';
  sendAt: string;
  state: 'scheduled' | 'sending' | 'sent' | 'cancelled';
  invited: number;
  sent: number;
  failed: number;
  started: number;
  completed: number;
}
interface Waves {
  emailEnabled: boolean;
  smsEnabled: boolean;
  items: Wave[];
}
interface Contacts {
  total: number;
  unsubscribed: number;
}

const DEFAULT_BODY = 'Hello [name],\n\nWe would value your opinion. The survey takes about 10 minutes:\n[link]\n\nThank you!';
const DEFAULT_SMS = 'Hi [name], please share your views in a short survey: [link]';

/** Email and SMS invitation waves to the survey's contact list (contacts are imported on the web). */
export function Distribution({ surveyId }: { surveyId: string }) {
  const waves = useApi<Waves>(`/surveys/${surveyId}/distributions`);
  const contacts = useApi<Contacts>(`/surveys/${surveyId}/contacts`);
  const { api } = useSession();
  const [channel, setChannel] = useState<'EMAIL' | 'SMS'>('EMAIL');
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('Share your views');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [inMinutes, setInMinutes] = useState('60');
  const a = useAction();
  const send = () =>
    a.run(async () => {
      await api.post(`/surveys/${surveyId}/distributions`, {
        name: name.trim(),
        channel,
        subject: channel === 'EMAIL' ? subject : '',
        body,
        sendAt: new Date(Date.now() + Number(inMinutes) * 60_000).toISOString(),
      });
      setName('');
      await waves.reload();
    });
  const cancel = (w: Wave) =>
    a.run(async () => (await api.post(`/surveys/${surveyId}/distributions/${w.id}/cancel`), await waves.reload()));
  return (
    <Section refreshing={waves.loading} onRefresh={waves.reload}>
      <Async q={contacts}>
        {(c) => (
          <Card>
            <KV k="Contacts" v={c.total.toLocaleString()} />
            <KV k="Unsubscribed" v={c.unsubscribed.toLocaleString()} />
          </Card>
        )}
      </Async>
      <Async q={waves}>
        {(w) => (
          <>
            <H2>Waves</H2>
            <List
              items={w.items}
              empty="No invitation waves yet."
              render={(wave) => (
                <Row
                  title={`${wave.name} · ${wave.channel}`}
                  subtitle={`${when(wave.sendAt)} · ${wave.sent}/${wave.invited} sent · ${wave.started} started · ${wave.completed} completed${wave.failed ? ` · ${wave.failed} failed` : ''}`}
                  right={
                    <View style={{ gap: 6, alignItems: 'flex-end' }}>
                      <Pill label={wave.state} />
                      {wave.state === 'scheduled' ? <Button small kind="ghost" title="Cancel" onPress={() => void cancel(wave)} /> : null}
                    </View>
                  }
                />
              )}
            />
            <H2>New wave</H2>
            <Card>
              {!w.emailEnabled && !w.smsEnabled ? (
                <T muted>No email or SMS provider is set up yet; the super admin connects one under Integrations.</T>
              ) : null}
              <Segmented
                value={channel}
                onChange={(c) => {
                  setChannel(c);
                  setBody(c === 'SMS' ? DEFAULT_SMS : DEFAULT_BODY);
                }}
                options={[
                  ...(w.emailEnabled ? [{ key: 'EMAIL' as const, label: 'Email' }] : []),
                  ...(w.smsEnabled ? [{ key: 'SMS' as const, label: 'SMS' }] : []),
                ]}
              />
              <Field label="Wave name" value={name} onChangeText={setName} placeholder="Wave 1" />
              {channel === 'EMAIL' ? <Field label="Subject" value={subject} onChangeText={setSubject} /> : null}
              <Field label="Message ([name] and [link] are filled in)" value={body} onChangeText={setBody} multiline />
              <Field label="Send in (minutes)" value={inMinutes} onChangeText={setInMinutes} keyboardType="number-pad" />
              {a.error ? <ErrorNote message={a.error} /> : null}
              <Button
                title="Schedule wave"
                icon="paper-plane-outline"
                onPress={() => void send()}
                busy={a.busy}
                disabled={
                  !name.trim() ||
                  !body.includes('[link]') ||
                  !/^\d+$/.test(inMinutes) ||
                  (channel === 'EMAIL' ? !w.emailEnabled : !w.smsEnabled)
                }
              />
            </Card>
          </>
        )}
      </Async>
    </Section>
  );
}
