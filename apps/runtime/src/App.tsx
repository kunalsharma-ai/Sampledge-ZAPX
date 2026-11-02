/**
 * Hosted respondent runtime.
 *   /s/:surveyId?vid=..&uid=..   entry link given to sample vendors
 *   /r/:token                    the respondent's session (bookmarkable to resume)
 * The server decides routing; this app renders the page it is given and posts answers back.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Honeypot,
  SurveyHeader,
  SurveyPage,
  answersToSubmit,
  defaultThemeCss,
  pendingMedia,
  themeCss,
  usePageSignals,
  type DisplayQuestion,
  type FieldErrors,
  type PhotoHandler,
} from '@zapx/survey-renderer';
import type { AnswerValue, Answers, Theme } from '@zapx/survey-schema';

interface Look {
  theme: Theme;
  gridOnMobile: 'cards' | 'scroll';
  language: string;
  languages: Array<{ tag: string; name: string }>;
  ui: {
    next: string;
    back: string;
    saving: string;
    language: string;
    fixErrors: string;
    rankUp?: string;
    rankDown?: string;
    sumRemaining?: string;
    playToEnd?: string;
    readAloud?: string;
    stopReading?: string;
    takePhoto?: string;
    retakePhoto?: string;
    photoUploading?: string;
    photoFailed?: string;
    photoSaved?: string;
  };
  readAloud?: boolean;
}

type State =
  | {
      state: 'in_progress';
      token?: string;
      look: Look;
      survey: { title: string; welcome?: string; showProgress: boolean; allowBack: boolean; language: string };
      page: { id: string; title?: string; questions: DisplayQuestion[] };
      answers: Answers;
      context: Answers;
      progress: number;
      isFirstPage: boolean;
      isTest: boolean;
    }
  | { state: 'finished'; status: string; message: string; redirectUrl: string | null; isTest: boolean; look?: Look }
  | { state: 'unavailable'; message: string };

/**
 * Browser traits for the same-device check (Milestone 12). Only coarse values every site can read; no
 * canvas, audio or font probing. The server keeps a keyed hash of them, never the values.
 */
function deviceTraits() {
  const n = navigator as Navigator & { deviceMemory?: number };
  return {
    screen: `${window.screen.width}x${window.screen.height}x${window.screen.colorDepth}`,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    langs: (navigator.languages ?? [navigator.language]).join(',').slice(0, 100),
    platform: navigator.platform ?? '',
    cores: navigator.hardwareConcurrency ?? 0,
    memory: n.deviceMemory ?? 0,
    touch: navigator.maxTouchPoints ?? 0,
  };
}

async function api<T>(path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [view, setView] = useState<State | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const [look, setLook] = useState<Look | null>(null);
  /** Questions on this page whose video or audio has been played to the end. */
  const [played, setPlayed] = useState<ReadonlySet<string>>(new Set());
  const signals = usePageSignals();
  const { reset: resetSignals } = signals;

  const show = useCallback(
    (s: State) => {
      setView(s);
      setErrors({});
      if (s.state !== 'unavailable' && s.look) {
        setLook(s.look);
        document.documentElement.lang = s.look.language;
      }
      if (s.state === 'in_progress') {
        setAnswers(s.answers ?? {});
        setPlayed(new Set());
        resetSignals();
        document.title = s.survey.title;
        window.scrollTo({ top: 0 });
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.zx-card')?.focus());
      }
      if (s.state === 'finished' && s.redirectUrl) {
        const url = s.redirectUrl;
        setTimeout(() => window.location.replace(url), 800);
      }
    },
    [resetSignals],
  );

  useEffect(() => {
    const path = window.location.pathname;
    const entry = path.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
    const session = path.match(/^\/r\/([A-Za-z0-9_-]+)\/?$/);
    (async () => {
      if (entry) {
        const query = Object.fromEntries(new URLSearchParams(window.location.search));
        // Coarse hints for device rules (iPads report a desktop user agent), whether automation software
        // drives the browser, and the traits behind the same-device check.
        const client = {
          touch: navigator.maxTouchPoints > 0,
          screenShortSide: Math.min(window.screen.width, window.screen.height),
          automation: navigator.webdriver === true,
          traits: deviceTraits(),
        };
        const { data } = await api<State & { token?: string }>(`/public/s/${entry[1]}/start`, { query, client });
        if (data.state === 'in_progress' && data.token) {
          setToken(data.token);
          // Replace the entry URL (which carries the UID) with the private session URL.
          window.history.replaceState(null, '', `/r/${data.token}`);
        }
        show(data);
      } else if (session) {
        setToken(session[1]!);
        const { status, data } = await api<State>(`/public/r/${session[1]}`);
        if (status === 404) setFatal('This survey session was not found.');
        else show(data);
      } else {
        setFatal('This survey link is not valid.');
      }
    })().catch(() => setFatal('We could not load the survey. Please check your connection and try again.'));
  }, [show]);

  const onChange = (id: string, v: AnswerValue) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setErrors((e) => ({ ...e, [id]: undefined }));
  };

  const submit = async () => {
    if (!token || view?.state !== 'in_progress') return;
    setBusy(true);
    try {
      const payload = answersToSubmit(view.page.questions, answers, view.context);
      const { status, data } = await api<State & { errors?: Array<{ questionId: string; message: string }>; message?: string }>(
        `/public/r/${token}/answers`,
        { pageId: view.page.id, answers: payload, signals: signals.read() },
      );
      if (status === 422 && data.errors) {
        setErrors(Object.fromEntries(data.errors.map((e) => [e.questionId, e.message])));
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.zx-has-error input, .zx-has-error textarea')?.focus());
      } else if (status === 409) {
        const fresh = await api<State>(`/public/r/${token}`);
        show(fresh.data);
      } else if (status >= 400) {
        setFatal('Something went wrong. Please reload the page to continue.');
      } else show(data);
    } catch {
      setFatal('We could not save your answers. Please check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const switchLanguage = async (language: string) => {
    if (!token) return;
    setBusy(true);
    try {
      const current = answers;
      const { status, data } = await api<State>(`/public/r/${token}/language`, { language });
      if (status < 400) {
        show(data);
        // Keep what the respondent already entered on this page.
        if (data.state === 'in_progress') setAnswers((a) => ({ ...a, ...current }));
      }
    } finally {
      setBusy(false);
    }
  };

  const back = async () => {
    if (!token) return;
    setBusy(true);
    try {
      show((await api<State>(`/public/r/${token}/back`, {})).data);
    } finally {
      setBusy(false);
    }
  };

  const photos: PhotoHandler = {
    take: async (questionId, photo) => {
      const form = new FormData();
      form.append('questionId', questionId);
      form.append('file', photo, 'photo.jpg');
      const res = await fetch(`/api/public/r/${token}/captures`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return ((await res.json()) as { ref: string }).ref;
    },
  };

  const waiting = view?.state === 'in_progress' && pendingMedia(view.page.questions, answers, view.context, played).length > 0;

  return (
    <div className="zx-root">
      <style>{defaultThemeCss}</style>
      {look ? <style>{themeCss(look.theme, { allowed: ['desktop', 'tablet', 'mobile'], gridOnMobile: look.gridOnMobile })}</style> : null}
      <main className="zx-shell">
        {fatal ? (
          <div className="zx-card" role="alert">
            <p>{fatal}</p>
          </div>
        ) : !view ? (
          <div className="zx-card" aria-busy="true">
            <p>Loading…</p>
          </div>
        ) : view.state === 'unavailable' ? (
          <div className="zx-card">
            <p>{view.message}</p>
          </div>
        ) : view.state === 'finished' ? (
          <div className="zx-card" data-status={view.status}>
            {view.look?.theme.logo ? <SurveyHeader theme={view.look.theme} /> : null}
            {view.isTest ? <p className="zx-test-banner">Test response · status: {view.status}</p> : null}
            <p>{view.message}</p>
            {view.redirectUrl ? <p className="zx-help">Redirecting…</p> : null}
          </div>
        ) : (
          <form
            className="zx-card"
            {...signals.handlers}
            tabIndex={-1}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            noValidate
          >
            {view.look.languages.length > 1 ? (
              <div className="zx-lang">
                <select
                  aria-label={view.look.ui.language}
                  value={view.look.language}
                  onChange={(e) => void switchLanguage(e.target.value)}
                  disabled={busy}
                >
                  {view.look.languages.map((l) => (
                    <option key={l.tag} value={l.tag} lang={l.tag}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {view.isTest ? (
              <p className="zx-test-banner">Test mode: this response is flagged as a test and does not count toward quotas.</p>
            ) : null}
            <SurveyHeader
              theme={view.look.theme}
              progress={view.survey.showProgress ? view.progress : undefined}
              progressLabel="Progress"
            />
            {view.survey.welcome ? <p className="zx-welcome">{view.survey.welcome}</p> : null}
            {view.page.title ? <h1 className="zx-title">{view.page.title}</h1> : null}
            <SurveyPage
              questions={view.page.questions}
              answers={answers}
              context={view.context}
              errors={errors}
              disabled={busy}
              onChange={onChange}
              onMediaPlayed={(id) => setPlayed((p) => new Set(p).add(id))}
              readAloud={view.look.readAloud}
              language={view.look.language}
              messages={view.look.ui}
              photos={photos}
            />
            <Honeypot inputRef={signals.honeypot} />
            {waiting ? <p className="zx-media-wait">{view.look.ui.playToEnd}</p> : null}
            <div className="zx-actions">
              {view.survey.allowBack && !view.isFirstPage ? (
                <button type="button" className="zx-button zx-secondary" onClick={() => void back()} disabled={busy}>
                  {view.look.ui.back}
                </button>
              ) : (
                <span />
              )}
              <button type="submit" className="zx-button" disabled={busy || waiting}>
                {busy ? view.look.ui.saving : view.look.ui.next}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}
