/**
 * ZAPX Interviewer (CAPI). Sign in once online, download assigned surveys, then interview with or
 * without a connection. Finished interviews sync automatically when the device is back online,
 * or with "Sync now".
 */
import { useCallback, useEffect, useState } from 'react';
import { nextPageIndex, prepareSurvey } from '@zapx/logic-engine';
import { capiSettingsOf, parseSurveyDefinition } from '@zapx/survey-schema';
import { locate } from './capture';
import { NotSignedIn, downloadPackage, signIn, signOut, syncNow } from './api';
import { Interview } from './Interview';
import { interviews, meta, type Interviewer, type LocalInterview, type PackagedSurvey, type SurveyPackage } from './store';

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function App() {
  const online = useOnline();
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Interviewer | null>(null);
  const [pkg, setPkg] = useState<SurveyPackage | null>(null);
  const [list, setList] = useState<LocalInterview[]>([]);
  const [open, setOpen] = useState<{ survey: PackagedSurvey; record: LocalInterview } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshLocal = useCallback(async () => setList(await interviews.all()), []);

  useEffect(() => {
    void (async () => {
      setMe((await meta.get<Interviewer>('interviewer')) ?? null);
      setPkg((await meta.get<SurveyPackage>('package')) ?? null);
      await refreshLocal();
      setReady(true);
    })();
  }, [refreshLocal]);

  const sync = useCallback(async () => {
    if (!me || !navigator.onLine) return;
    setBusy(true);
    setProblem(null);
    try {
      const s = await syncNow(me.id);
      if (s.sent || s.waitingForFiles)
        setNote(
          [
            s.sent ? `Synced ${s.stored} interview${s.stored === 1 ? '' : 's'}${s.rejected ? `, ${s.rejected} not accepted` : ''}.` : '',
            s.waitingForFiles
              ? `${s.waitingForFiles} interview${s.waitingForFiles === 1 ? ' waits' : 's wait'} for photos or a recording to finish uploading; they sync next time.`
              : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
      setPkg(await downloadPackage());
      setNeedsSignIn(false);
    } catch (e) {
      if (e instanceof NotSignedIn) setNeedsSignIn(true);
      else setProblem((e as Error).message);
    } finally {
      await refreshLocal();
      setBusy(false);
    }
  }, [me, refreshLocal]);

  // Sync when the app opens online and whenever the connection comes back.
  useEffect(() => {
    if (ready && me && online) void sync();
  }, [ready, me, online, sync]);

  if (!ready) return null;
  if (open)
    return (
      <Interview
        survey={open.survey}
        record={open.record}
        onExit={() => {
          setOpen(null);
          void refreshLocal().then(() => (navigator.onLine ? sync() : undefined));
        }}
      />
    );

  if (!me || needsSignIn)
    return (
      <SignIn
        online={online}
        again={needsSignIn ? me : null}
        onSignedIn={async (who) => {
          if (me && me.id !== who.id && list.some((i) => i.interviewerId === me.id && i.state === 'finished'))
            setNote(`Interviews by ${me.name} stay on this device until ${me.name} signs in again.`);
          setMe(who);
          setNeedsSignIn(false);
          try {
            setPkg(await downloadPackage());
          } catch (e) {
            setProblem((e as Error).message);
          }
        }}
      />
    );

  const mine = list.filter((i) => i.interviewerId === me.id);
  const waiting = mine.filter((i) => i.state === 'finished');
  const unfinished = mine.filter((i) => i.state === 'in_progress');

  const start = async (s: PackagedSurvey) => {
    const parsed = parseSurveyDefinition(s.version.definition);
    if (!parsed.ok) return setProblem('This survey package could not be read. Update your surveys.');
    setProblem(null);
    const capture = capiSettingsOf(parsed.definition);
    let location: LocalInterview['location'];
    if (capture.gps !== 'off') {
      setBusy(true);
      setNote('Finding the location of this interview…');
      const at = await locate();
      setBusy(false);
      setNote(null);
      if (!at && capture.gps === 'required')
        return setProblem(
          'This survey records where each interview takes place. Allow this app to use your location (and turn on location services), then start the interview again.',
        );
      location = { start: at, end: null };
    }
    const clientId = crypto.randomUUID();
    const record: LocalInterview = {
      clientId,
      interviewerId: me.id,
      surveyId: s.surveyId,
      versionId: s.version.id,
      surveyName: s.name,
      answers: {},
      pageIndex: nextPageIndex(prepareSurvey(parsed.definition), {}, -1, clientId),
      language: parsed.definition.language,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: 0,
      endedEarly: false,
      state: 'in_progress',
      localOutcome: null,
      serverStatus: null,
      serverReason: null,
      ...(location ? { location } : {}),
    };
    await interviews.put(record);
    setOpen({ survey: s, record });
  };

  const surveyFor = (i: LocalInterview) => pkg?.surveys.find((s) => s.surveyId === i.surveyId && s.version.id === i.versionId);

  return (
    <div className="capi">
      <header className="capi-top">
        <strong>ZAPX Interviewer</strong>
        <span className={`capi-pill ${online ? 'ok' : 'off'}`} data-testid="connection">
          {online ? 'Online' : 'Offline'}
        </span>
        <span className="capi-spacer" />
        <span className="capi-muted">{me.name}</span>
        <button
          className="capi-link"
          onClick={async () => {
            if (waiting.length && !window.confirm(`${waiting.length} interview(s) are not synced yet. They stay on this device. Sign out?`))
              return;
            await signOut();
            setMe(null);
          }}
        >
          Sign out
        </button>
      </header>
      <main className="capi-main">
        {note ? (
          <p className="capi-note" role="status">
            {note}
          </p>
        ) : null}
        {problem ? (
          <p className="capi-problem" role="alert">
            {problem}
          </p>
        ) : null}

        <section className="capi-card" data-testid="sync-panel">
          <div className="capi-row">
            <div>
              <strong data-testid="waiting-count">{waiting.length}</strong> waiting to sync
              {unfinished.length ? <span className="capi-muted"> · {unfinished.length} unfinished</span> : null}
            </div>
            <span className="capi-spacer" />
            <button className="capi-button" disabled={!online || busy} onClick={() => void sync()}>
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          {!online ? (
            <p className="capi-muted">
              You are offline. Keep interviewing; everything is saved on this device and syncs when you are back online.
            </p>
          ) : null}
          {pkg ? <p className="capi-muted">Surveys updated {new Date(pkg.generatedAt).toLocaleString()}.</p> : null}
        </section>

        <h2>Surveys</h2>
        {!pkg || pkg.surveys.length === 0 ? (
          <p className="capi-muted">No surveys are assigned to you yet. Ask your project manager, then sync.</p>
        ) : null}
        {pkg?.surveys.map((s) => {
          const local = mine.filter((i) => i.surveyId === s.surveyId);
          return (
            <section className="capi-card" key={s.surveyId} data-testid="capi-survey">
              <div className="capi-row">
                <div>
                  <strong>{s.name}</strong> <span className="capi-muted">v{s.version.version}</span>
                  <div className="capi-muted">
                    {s.completesSynced} complete{s.completesSynced === 1 ? '' : 's'} synced{s.target ? ` of ${s.target}` : ''} ·{' '}
                    {local.filter((i) => i.state !== 'synced').length} on this device
                  </div>
                </div>
                <span className="capi-spacer" />
                {s.status === 'LIVE' ? (
                  <button className="capi-button" disabled={busy} onClick={() => void start(s)}>
                    Start interview
                  </button>
                ) : (
                  <span className="capi-pill off">{s.status.toLowerCase()}: no new interviews</span>
                )}
              </div>
            </section>
          );
        })}

        <h2>Interviews on this device</h2>
        {mine.length === 0 ? <p className="capi-muted">None yet.</p> : null}
        <table className="capi-table" data-testid="local-interviews">
          <tbody>
            {[...mine]
              .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
              .map((i) => {
                const s = surveyFor(i);
                return (
                  <tr key={i.clientId}>
                    <td className="capi-mono">{i.clientId.slice(0, 8)}</td>
                    <td>{i.surveyName}</td>
                    <td>{new Date(i.startedAt).toLocaleString()}</td>
                    <td>
                      {i.state === 'in_progress' ? (
                        s ? (
                          <button className="capi-link" onClick={() => setOpen({ survey: s, record: i })}>
                            Continue
                          </button>
                        ) : (
                          'unfinished (survey version no longer on this device)'
                        )
                      ) : i.state === 'finished' ? (
                        <span className="capi-pill">waiting · {i.localOutcome}</span>
                      ) : i.state === 'synced' ? (
                        <span className="capi-pill ok">
                          synced · {i.serverStatus}
                          {i.serverReason ? ` (${i.serverReason})` : ''}
                        </span>
                      ) : (
                        <span className="capi-pill off" title={i.serverReason ?? ''}>
                          not accepted: {i.serverReason}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </main>
    </div>
  );
}

function SignIn({ online, again, onSignedIn }: { online: boolean; again: Interviewer | null; onSignedIn: (me: Interviewer) => void }) {
  const [email, setEmail] = useState(again?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="capi-main capi-narrow">
      <h1>ZAPX Interviewer</h1>
      {again ? <p>Your session has ended. Sign in again to sync; your interviews are safe on this device.</p> : null}
      {!online ? <p className="capi-problem">You are offline. Signing in needs a connection the first time.</p> : null}
      <form
        className="capi-card capi-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onSignedIn(await signIn(email.trim(), password));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="capi-field">
          Email
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="capi-field">
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error ? (
          <p className="capi-problem" role="alert">
            {error}
          </p>
        ) : null}
        <button className="capi-button" disabled={busy || !online}>
          Sign in
        </button>
      </form>
    </main>
  );
}
