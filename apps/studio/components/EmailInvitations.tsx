'use client';
/**
 * Blueprint phase 3: email distribution. Contacts (CSV), invitation waves sent at a scheduled time
 * with personal links, reminders to people who have not finished, and opt-outs. Blueprint phase 5
 * adds SMS: contacts can have a phone number, and a wave can be a text message.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { useConfirm } from '@/components/neon/ConfirmDialog';
import { InfoTip } from '@/components/neon/InfoTip';

interface Contacts {
  total: number;
  unsubscribed: number;
  emailEnabled: boolean;
  smsEnabled: boolean;
  items: Array<{
    id: string;
    email: string | null;
    phone: string | null;
    name: string | null;
    language: string | null;
    fields: Record<string, string>;
    unsubscribed: boolean;
  }>;
}
interface Wave {
  id: string;
  name: string;
  channel: 'email' | 'sms';
  subject: string;
  sendAt: string;
  sentAt: string | null;
  reminderDays: number;
  maxReminders: number;
  state: 'scheduled' | 'sending' | 'sent' | 'cancelled';
  invited: number;
  sent: number;
  queued: number;
  failed: number;
  reminded: number;
  started: number;
  completed: number;
}

const DEFAULT_SMS = 'Hi [name], please share your views in a short survey: [link]';
const DEFAULT_BODY = `Hello [name],

We would value your opinion. The survey takes about 10 minutes:
[link]

Thank you!`;

/** A datetime-local value for "in one hour", in the browser's time zone. */
function inAnHour() {
  const d = new Date(Date.now() + 3_600_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function EmailInvitations({ surveyId, readOnly, live }: { surveyId: string; readOnly: boolean; live: boolean }) {
  const confirm = useConfirm();
  const [contacts, setContacts] = useState<Contacts | null>(null);
  const [waves, setWaves] = useState<Wave[]>([]);
  const [csv, setCsv] = useState('');
  const [importNote, setImportNote] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: 'Wave 1',
    channel: 'EMAIL' as 'EMAIL' | 'SMS',
    subject: 'Your opinion matters',
    body: DEFAULT_BODY,
    sendAt: inAnHour(),
    reminderDays: 3,
    maxReminders: 1,
  });
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [c, w] = await Promise.all([
        api<Contacts>(`/surveys/${surveyId}/contacts`),
        api<{ items: Wave[] }>(`/surveys/${surveyId}/distributions`),
      ]);
      setContacts(c);
      setWaves(w.items);
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);

  const importCsv = async () => {
    setError(null);
    try {
      const r = await api<{ added: number; updated: number; errors: Array<{ row: number; message: string }>; ignoredColumns: string[] }>(
        `/surveys/${surveyId}/contacts/import`,
        { method: 'POST', body: { csv } },
      );
      setImportNote(
        [
          `${r.added} added, ${r.updated} updated.`,
          r.errors.length ? `Not imported: ${r.errors.map((e) => `row ${e.row} (${e.message})`).join('; ')}.` : '',
          r.ignoredColumns.length ? `Columns ignored: ${r.ignoredColumns.join(', ')}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      setCsv('');
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const schedule = async () => {
    setError(null);
    try {
      await api(`/surveys/${surveyId}/distributions`, {
        method: 'POST',
        body: { ...form, sendAt: new Date(form.sendAt).toISOString(), maxReminders: form.reminderDays ? form.maxReminders : 0 },
      });
      setForm((f) => ({ ...f, name: `Wave ${waves.length + 2}` }));
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const cancel = async (w: Wave) => {
    if (
      !(await confirm({
        title: `Cancel "${w.name}"?`,
        message: 'Emails not sent yet and all reminders are stopped.',
        confirmLabel: 'Cancel wave',
        cancelLabel: 'Keep it',
        tone: 'danger',
      }))
    )
      return;
    try {
      await api(`/surveys/${surveyId}/distributions/${w.id}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="panel stack" data-testid="email-invitations">
      <h2 style={{ margin: 0 }}>
        Email and SMS invitations
        <InfoTip k="section.invitations" />
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Each contact gets a personal link. Columns of the contact list other than email, name and language are added to the link as
        parameters (use them as URL variables). Every email has a one-click unsubscribe link, and people who opt out are never emailed again
        for this survey.
      </p>
      {contacts && !contacts.emailEnabled ? (
        <p className="note small" role="status" data-testid="email-off">
          Email sending is off on this server, so scheduled waves wait and nothing is sent. An administrator can turn it on with
          EMAIL_PROVIDER=sendgrid. Meanwhile, download a wave&apos;s personal links and send them with your own email tool.
        </p>
      ) : null}
      {contacts && !contacts.smsEnabled ? (
        <p className="note small" role="status" data-testid="sms-off">
          SMS sending is off on this server, so SMS waves wait. An administrator can turn it on with SMS_PROVIDER=twilio and SMS_FROM.
        </p>
      ) : null}
      <ErrorNote error={error} />

      <h3 style={{ margin: 0 }}>Contacts</h3>
      {contacts ? (
        <p className="small" style={{ margin: 0 }}>
          {contacts.total} contacts{contacts.unsubscribed ? `, ${contacts.unsubscribed} unsubscribed` : ''}.
        </p>
      ) : null}
      {contacts?.items.length ? (
        <details>
          <summary>Show the first {contacts.items.length}</summary>
          <table className="data">
            <thead>
              <tr>
                <th>Email</th>
                <th>Phone</th>
                <th>Contact name</th>
                <th>Link parameters</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.items.map((c) => (
                <tr key={c.id}>
                  <td>{c.email ?? ''}</td>
                  <td className="mono small">{c.phone ?? ''}</td>
                  <td>{c.name ?? ''}</td>
                  <td className="mono small">
                    {Object.entries(c.fields)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' ')}
                  </td>
                  <td>{c.unsubscribed ? <span className="badge">unsubscribed</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      {!readOnly ? (
        <div className="stack" style={{ gap: 6 }}>
          <label className="field">
            Paste contacts as CSV (header row with an email or phone column, phones with the country code such as +44; name, language and
            other columns optional)
            <textarea
              rows={4}
              className="mono"
              value={csv}
              placeholder={'email,name,region\nasha@example.com,Asha,North'}
              onChange={(e) => setCsv(e.target.value)}
            />
          </label>
          <div className="row">
            <label className="secondary btn" style={{ cursor: 'pointer' }}>
              Choose a CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setCsv(await f.text());
                  e.target.value = '';
                }}
              />
            </label>
            <button type="button" disabled={!csv.trim()} onClick={() => void importCsv()}>
              Import contacts
            </button>
          </div>
          {importNote ? (
            <p className="small" role="status">
              {importNote}
            </p>
          ) : null}
        </div>
      ) : null}

      <h3 style={{ margin: 0 }}>Invitation waves</h3>
      {waves.length ? (
        <table className="data" data-testid="waves">
          <thead>
            <tr>
              <th>Wave</th>
              <th>When</th>
              <th>Sent</th>
              <th>Reminders</th>
              <th>Started</th>
              <th>Completed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {waves.map((w) => (
              <tr key={w.id}>
                <td>
                  {w.name}{' '}
                  <span className={`badge ${w.state === 'sent' ? 'good' : w.state === 'cancelled' ? 'bad' : 'warn'}`}>{w.state}</span>
                  <div className="muted small">{w.channel === 'sms' ? 'SMS' : w.subject}</div>
                </td>
                <td className="small">{new Date(w.sendAt).toLocaleString()}</td>
                <td>
                  {w.sent} / {w.invited || contacts?.total || 0}
                  {w.failed ? <div className="small">{w.failed} failed</div> : null}
                </td>
                <td className="small">
                  {w.maxReminders ? `${w.reminded} sent (up to ${w.maxReminders}, every ${w.reminderDays} days)` : 'none'}
                </td>
                <td>{w.started}</td>
                <td>{w.completed}</td>
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    {!readOnly ? (
                      <a className="btn secondary" href={`/api/surveys/${surveyId}/distributions/${w.id}/links.csv`}>
                        Personal links
                      </a>
                    ) : null}
                    {!readOnly && w.state !== 'cancelled' ? (
                      <button type="button" className="secondary" onClick={() => void cancel(w)}>
                        Cancel
                      </button>
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          No waves yet.
        </p>
      )}
      {!readOnly ? (
        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }} disabled={!live}>
          {!live ? <p className="small">Publish the survey before scheduling invitations.</p> : null}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="field">
              Wave
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              Send by
              <select
                aria-label="Channel"
                data-testid="wave-channel"
                value={form.channel}
                onChange={(e) => {
                  const channel = e.target.value as 'EMAIL' | 'SMS';
                  setForm({
                    ...form,
                    channel,
                    body:
                      channel === 'SMS' && form.body === DEFAULT_BODY
                        ? DEFAULT_SMS
                        : channel === 'EMAIL' && form.body === DEFAULT_SMS
                          ? DEFAULT_BODY
                          : form.body,
                  });
                }}
              >
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS (text message)</option>
              </select>
            </label>
            <label className="field">
              Send at
              <input type="datetime-local" value={form.sendAt} onChange={(e) => setForm({ ...form, sendAt: e.target.value })} />
            </label>
            <label className="field">
              Remind after (days, 0 = never)
              <input
                type="number"
                min={0}
                max={60}
                value={form.reminderDays}
                onChange={(e) => setForm({ ...form, reminderDays: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="field">
              Reminders at most
              <input
                type="number"
                min={0}
                max={5}
                value={form.maxReminders}
                onChange={(e) => setForm({ ...form, maxReminders: Number(e.target.value) || 0 })}
              />
            </label>
          </div>
          {form.channel === 'EMAIL' ? (
            <label className="field">
              Subject
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </label>
          ) : null}
          <label className="field">
            Message ([link] = personal survey link, [name] = contact name, [unsubscribe] = opt-out link, added at the end if missing)
            <textarea
              rows={form.channel === 'SMS' ? 3 : 7}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
            {form.channel === 'SMS' ? (
              <span className="small muted">{form.body.length} of 600 characters. Only contacts with a phone number are texted.</span>
            ) : null}
          </label>
          <div>
            <button type="button" onClick={() => void schedule()} disabled={!form.body.includes('[link]')}>
              Schedule wave
            </button>
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
