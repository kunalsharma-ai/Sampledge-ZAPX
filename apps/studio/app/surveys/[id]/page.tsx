'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { analyzeSurvey, translationStatus, type AnalysisReport } from '@zapx/logic-engine';
import {
  defaultPresentation,
  parsePresentation,
  parseSurveyDefinition,
  type Presentation,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { CopyField, ErrorNote, Shell } from '@/components/Shell';
import { VisualEditor } from '@/components/VisualEditor';
import { Preview } from '@/components/Preview';
import { Assist } from '@/components/Assist';
import { QaLab } from '@/components/QaLab';
import { DesignStudio } from '@/components/DesignStudio';
import { Languages } from '@/components/Languages';
import { Quality } from '@/components/Quality';
import { CapiAssignments } from '@/components/CapiAssignments';

interface SurveyDetail {
  id: string;
  name: string;
  projectId: string;
  status: 'DRAFT' | 'LIVE' | 'PAUSED' | 'CLOSED';
  liveVersionId: string | null;
  versions: Array<{ id: string; version: number; status: string; publishedAt: string | null; updatedAt: string }>;
  responseCounts: Record<string, number>;
}
interface DraftVersion {
  id: string;
  version: number;
  status: string;
  updatedAt: string;
  definition: unknown;
  presentation: unknown;
}

type Tab = 'build' | 'json' | 'assist' | 'design' | 'languages' | 'preview' | 'qa' | 'distribute' | 'capi' | 'quality' | 'results';

export default function SurveyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const readOnly = me?.role === 'VIEWER';
  const [survey, setSurvey] = useState<SurveyDetail | null>(null);
  const [draft, setDraft] = useState<DraftVersion | null>(null);
  const [def, setDef] = useState<SurveyDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pres, setPres] = useState<Presentation>(defaultPresentation());
  const [presDirty, setPresDirty] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [tab, setTab] = useState<Tab>('build');
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, d] = await Promise.all([api<SurveyDetail>(`/surveys/${id}`), api<{ version: DraftVersion }>(`/surveys/${id}/draft`)]);
      setSurvey(s);
      setDraft(d.version);
      const parsed = parseSurveyDefinition(d.version.definition);
      setDef(parsed.ok ? parsed.definition : (d.version.definition as SurveyDefinition));
      const p = parsePresentation(d.version.presentation);
      setPres(p.ok ? p.presentation : defaultPresentation());
      setDirty(false);
      setPresDirty(false);
    } catch (e) {
      setError(e);
    }
  }, [id]);
  useEffect(() => {
    void load();
    void api<{ configured: boolean }>('/ai/status').then(
      (s) => setAiConfigured(s.configured),
      () => undefined,
    );
  }, [load]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || presDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, presDirty]);

  const report = useMemo<{ schemaIssues: Array<{ path: string; message: string }>; analysis: AnalysisReport | null }>(() => {
    if (!def) return { schemaIssues: [], analysis: null };
    const parsed = parseSurveyDefinition(def);
    if (!parsed.ok) return { schemaIssues: parsed.issues, analysis: null };
    return { schemaIssues: [], analysis: analyzeSurvey(parsed.definition) };
  }, [def]);
  const languageBlockers = useMemo(() => {
    if (!def || report.schemaIssues.length) return [];
    const parsed = parseSurveyDefinition(def);
    if (!parsed.ok) return [];
    return translationStatus(parsed.definition, pres)
      .filter((t) => t.enabled && !t.complete)
      .map((t) => `${t.name} is offered to respondents but ${t.total - t.reviewed} text(s) are missing, outdated or not reviewed.`);
  }, [def, pres, report.schemaIssues.length]);
  const publishable = report.schemaIssues.length === 0 && !!report.analysis?.ok && languageBlockers.length === 0;
  const unsaved = dirty || presDirty;

  const editPres = (p: Presentation) => {
    setPres(p);
    setPresDirty(true);
    setNotice(null);
  };

  const edit = (d: SurveyDefinition) => {
    setDef(d);
    setDirty(true);
    setNotice(null);
  };

  const save = async () => {
    if (!def || !draft) return;
    setBusy(true);
    setError(null);
    try {
      let current = draft;
      if (dirty) {
        current = (
          await api<{ version: DraftVersion }>(`/surveys/${id}/draft`, {
            method: 'PUT',
            body: { definition: def, expectedUpdatedAt: current.updatedAt },
          })
        ).version;
        setDraft(current);
        setDirty(false);
      }
      if (presDirty) {
        current = (
          await api<{ version: DraftVersion }>(`/surveys/${id}/draft/presentation`, {
            method: 'PUT',
            body: { presentation: pres, expectedUpdatedAt: current.updatedAt },
          })
        ).version;
        setDraft(current);
        setPresDirty(false);
      }
      setNotice(`Saved draft v${current.version}.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (unsaved) await save();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ version: { version: number } }>(`/surveys/${id}/publish`, { method: 'POST' });
      setNotice(`Published version ${r.version.version}. Respondents now receive it.`);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (!survey || !def || !draft) {
    return (
      <Shell>
        <ErrorNote error={error} />
        {!error ? <p className="muted">Loading…</p> : null}
      </Shell>
    );
  }

  const live = survey.versions.find((v) => v.id === survey.liveVersionId);

  return (
    <Shell
      crumbs={
        <>
          <Link href="/">Projects</Link> / <Link href={`/projects/${survey.projectId}`}>Project</Link>
        </>
      }
    >
      <div className="row">
        <div>
          <h1>{survey.name}</h1>
          <div className="row small">
            <span className={`badge ${survey.status.toLowerCase()}`}>{survey.status.toLowerCase()}</span>
            <span className="muted">
              Editing draft v{draft.version}
              {draft.status !== 'DRAFT' ? ` (${draft.status.toLowerCase()})` : ''} · live version: {live ? `v${live.version}` : 'none'}
            </span>
            {unsaved ? <span className="badge warn">unsaved changes</span> : null}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!readOnly ? (
          <>
            <button onClick={save} disabled={busy || !unsaved}>
              Save draft
            </button>
            <button
              className="primary"
              onClick={publish}
              disabled={busy || !publishable}
              title={publishable ? '' : languageBlockers.length ? languageBlockers.join(' ') : 'Fix the errors in the logic check first'}
            >
              Publish
            </button>
          </>
        ) : null}
      </div>
      {notice ? <p className="ok-text">{notice}</p> : null}
      <ErrorNote error={error} />

      <div className="tabs" role="tablist">
        {(
          [
            ['build', 'Build'],
            ['json', 'JSON'],
            ['assist', 'AI & import'],
            ['design', 'Design'],
            ['languages', 'Languages'],
            ['preview', 'Preview'],
            ['qa', 'QA lab'],
            ['distribute', 'Links & status'],
            ['capi', 'Interviewers'],
            ['quality', 'Quality & fieldwork'],
            ['results', 'Quotas & data'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'build' || tab === 'json' ? (
        <div className="editor" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
          <div>
            {tab === 'build' ? (
              <VisualEditor def={def} onChange={edit} readOnly={readOnly} />
            ) : (
              <JsonEditor def={def} onApply={edit} readOnly={readOnly} />
            )}
          </div>
          <LogicReport schemaIssues={report.schemaIssues} analysis={report.analysis} languageBlockers={languageBlockers} />
        </div>
      ) : null}
      {tab === 'preview' ? <Preview key={JSON.stringify(def).length + draft.version} def={def} presentation={pres} /> : null}
      {tab === 'design' ? <DesignStudio def={def} presentation={pres} readOnly={readOnly} onChange={editPres} /> : null}
      {tab === 'languages' ? (
        <Languages
          surveyId={id}
          def={def}
          presentation={pres}
          readOnly={readOnly}
          dirty={unsaved}
          aiConfigured={aiConfigured}
          onChange={editPres}
          onServerUpdate={(v) => {
            const p = parsePresentation(v.presentation);
            if (p.ok) setPres(p.presentation);
            setDraft((d) => (d ? { ...d, updatedAt: v.updatedAt, presentation: v.presentation } : d));
          }}
        />
      ) : null}
      {tab === 'assist' ? <Assist surveyId={id} language={def.language} readOnly={readOnly} dirty={unsaved} onApplied={load} /> : null}
      {tab === 'qa' ? <QaLab surveyId={id} readOnly={readOnly} dirty={dirty} hasLive={!!survey.liveVersionId} /> : null}
      {tab === 'distribute' ? <Distribute survey={survey} readOnly={readOnly} onChanged={load} /> : null}
      {tab === 'capi' ? <CapiAssignments surveyId={id} readOnly={readOnly} hasLive={!!survey.liveVersionId} /> : null}
      {tab === 'quality' ? <Quality surveyId={id} def={def} readOnly={readOnly} onChange={edit} /> : null}
      {tab === 'results' ? <Results surveyId={id} /> : null}
    </Shell>
  );
}

function JsonEditor({ def, onApply, readOnly }: { def: SurveyDefinition; onApply: (d: SurveyDefinition) => void; readOnly?: boolean }) {
  const [text, setText] = useState(() => JSON.stringify(def, null, 2));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(def, null, 2)), [def]);
  const apply = () => {
    try {
      const parsed = JSON.parse(text);
      const r = parseSurveyDefinition(parsed);
      if (!r.ok) {
        setErr(r.issues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('\n'));
        return;
      }
      setErr(null);
      onApply(r.definition);
    } catch (e) {
      setErr(`Not valid JSON: ${(e as Error).message}`);
    }
  };
  return (
    <div className="panel stack">
      <p className="muted small">The canonical survey definition. Paste a full definition here, then apply it.</p>
      <textarea
        aria-label="Survey definition JSON"
        rows={30}
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={readOnly}
        spellCheck={false}
      />
      {err ? (
        <pre className="error-text small" style={{ whiteSpace: 'pre-wrap' }}>
          {err}
        </pre>
      ) : null}
      {!readOnly ? (
        <div>
          <button className="primary" onClick={apply}>
            Apply JSON
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LogicReport({
  schemaIssues,
  analysis,
  languageBlockers = [],
}: {
  schemaIssues: Array<{ path: string; message: string }>;
  analysis: AnalysisReport | null;
  languageBlockers?: string[];
}) {
  return (
    <aside className="panel" aria-live="polite" data-testid="logic-report">
      <h2>Logic check</h2>
      {schemaIssues.length ? (
        <>
          <p className="error-text">The definition is incomplete:</p>
          {schemaIssues.map((i, n) => (
            <div key={n} className="issue error">
              <div>{i.message}</div>
              <div className="loc">{i.path}</div>
            </div>
          ))}
        </>
      ) : analysis ? (
        <>
          <p className={analysis.ok ? 'ok-text' : 'error-text'}>
            {analysis.ok ? 'Ready to publish.' : 'Fix these errors before publishing.'} {analysis.errors} error(s), {analysis.warnings}{' '}
            warning(s).
          </p>
          {languageBlockers.map((b) => (
            <div key={b} className="issue error">
              <div>{b}</div>
              <div className="loc">Languages tab</div>
            </div>
          ))}
          {analysis.issues.map((i, n) => (
            <div key={n} className={`issue ${i.severity}`}>
              <div>{i.message}</div>
              <div className="loc">
                {i.code} · {i.location}
              </div>
            </div>
          ))}
        </>
      ) : null}
    </aside>
  );
}

interface Vendor {
  id: string;
  name: string;
  code: string;
}

function Distribute({ survey, readOnly, onChanged }: { survey: SurveyDetail; readOnly: boolean; onChanged: () => void }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [uid, setUid] = useState('');
  const [country, setCountry] = useState('');
  const [link, setLink] = useState<{ url: string; template: string | null } | null>(null);
  const [testLink, setTestLink] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Vendor[]>(`/projects/${survey.projectId}/vendors`)
      .then((v) => {
        setVendors(v);
        if (v[0]) setVendorId(v[0].id);
      })
      .catch(setError);
  }, [survey.projectId]);

  const make = async (test: boolean) => {
    setError(null);
    try {
      const r = await api<{ url: string; template: string | null }>(`/surveys/${survey.id}/links`, {
        body: { vendorId: test ? undefined : vendorId, uid: uid || undefined, country: country || undefined, test },
      });
      if (test) setTestLink(r.url);
      else setLink(r);
    } catch (e) {
      setError(e);
    }
  };

  const setStatus = async (status: 'LIVE' | 'PAUSED' | 'CLOSED') => {
    try {
      await api(`/surveys/${survey.id}/status`, { body: { status } });
      onChanged();
    } catch (e) {
      setError(e);
    }
  };

  if (!survey.liveVersionId) return <p className="muted">Publish the survey to get links.</p>;
  return (
    <div className="grid2">
      <section className="panel stack">
        <h2>Vendor links</h2>
        {vendors.length === 0 ? (
          <p className="muted">
            Add a vendor on the <Link href={`/projects/${survey.projectId}`}>project page</Link> first.
          </p>
        ) : (
          <>
            <div className="row">
              <label className="field">
                Vendor
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                UID (for a single link)
                <input value={uid} onChange={(e) => setUid(e.target.value)} placeholder="e.g. 12345" />
              </label>
              <label className="field">
                Country code
                <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" style={{ width: 70 }} />
              </label>
            </div>
            <div>
              <button onClick={() => make(false)} disabled={readOnly || !uid}>
                Generate link
              </button>
            </div>
            {link ? (
              <>
                {link.template ? (
                  <>
                    <span className="small muted">Template to give the vendor (they replace [UID]):</span>
                    <CopyField label="Vendor link template" value={link.template} />
                  </>
                ) : null}
                <span className="small muted">Link for UID {uid}:</span>
                <CopyField label="Respondent link" value={link.url} />
              </>
            ) : null}
          </>
        )}
        <h2 style={{ marginTop: 12 }}>Test link</h2>
        <p className="muted small">Test responses are flagged, excluded from quotas and exports by default, and never redirect.</p>
        <div>
          <button onClick={() => make(true)} disabled={readOnly}>
            Create test link
          </button>
        </div>
        {testLink ? (
          <>
            <CopyField label="Test link" value={testLink} />
            <a href={testLink} target="_blank" rel="noreferrer" data-testid="open-test-link">
              Open test link
            </a>
          </>
        ) : null}
        <ErrorNote error={error} />
      </section>
      <section className="panel stack">
        <h2>Field status</h2>
        <p>
          Currently <span className={`badge ${survey.status.toLowerCase()}`}>{survey.status.toLowerCase()}</span>
        </p>
        <p className="muted small">
          Paused and closed surveys send new respondents to the quota-full redirect. Respondents already in progress can finish.
        </p>
        {!readOnly ? (
          <div className="row">
            <button onClick={() => setStatus('LIVE')} disabled={survey.status === 'LIVE'}>
              Go live
            </button>
            <button onClick={() => setStatus('PAUSED')} disabled={survey.status === 'PAUSED'}>
              Pause
            </button>
            <button className="danger" onClick={() => setStatus('CLOSED')} disabled={survey.status === 'CLOSED'}>
              Close
            </button>
          </div>
        ) : null}
        <h3>Versions</h3>
        <table className="data">
          <tbody>
            {survey.versions.map((v) => (
              <tr key={v.id}>
                <td>v{v.version}</td>
                <td>
                  <span className="badge">{v.status.toLowerCase()}</span>
                </td>
                <td className="muted small">
                  {v.publishedAt
                    ? `published ${new Date(v.publishedAt).toLocaleString()}`
                    : `edited ${new Date(v.updatedAt).toLocaleString()}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

interface QuotaRow {
  id: string;
  label: string;
  condition: string;
  target: number;
  count: number;
}
interface ResponseRow {
  id: string;
  uid: string;
  country: string | null;
  language: string | null;
  device: string | null;
  status: string;
  outcomeReason: string | null;
  isTest: boolean;
  startedAt: string;
  completedAt: string | null;
  vendor: { code: string } | null;
  version: { version: number };
  mode: 'CAWI' | 'CAPI';
  qualityScore: number | null;
  reviewState: string;
  interviewer: { name: string } | null;
}

function Results({ surveyId }: { surveyId: string }) {
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [responses, setResponses] = useState<ResponseRow[]>([]);
  const [includeTest, setIncludeTest] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setQuotas(await api<QuotaRow[]>(`/surveys/${surveyId}/quotas`));
      setResponses(await api<ResponseRow[]>(`/surveys/${surveyId}/responses?includeTest=${includeTest}`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId, includeTest]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <ErrorNote error={error} />
      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Quotas</h2>
          <div style={{ flex: 1 }} />
          <button onClick={load}>Refresh</button>
        </div>
        {quotas.length === 0 ? (
          <p className="muted">No quotas in the live version.</p>
        ) : (
          <table className="data" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Quota</th>
                <th>Condition</th>
                <th>Completes</th>
                <th>Target</th>
                <th>Fill</th>
              </tr>
            </thead>
            <tbody>
              {quotas.map((q) => (
                <tr key={q.id}>
                  <td>{q.label}</td>
                  <td className="mono small">{q.condition}</td>
                  <td>{q.count}</td>
                  <td>{q.target}</td>
                  <td>
                    <div className="bar" title={`${q.count} of ${q.target}`}>
                      <div style={{ width: `${q.target ? Math.min(100, (q.count / q.target) * 100) : 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <div className="row">
          <h2 style={{ margin: 0 }}>Responses</h2>
          <label className="check small">
            <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> include tests
          </label>
          <div style={{ flex: 1 }} />
          <a className="btn" href={`/api/surveys/${surveyId}/export?format=csv&includeTest=${includeTest}`}>
            Export CSV
          </a>
          <a className="btn" href={`/api/surveys/${surveyId}/export?format=xlsx&includeTest=${includeTest}`}>
            Export Excel
          </a>
        </div>
        {responses.length === 0 ? (
          <p className="muted">No responses yet.</p>
        ) : (
          <table className="data" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>UID</th>
                <th>Vendor</th>
                <th>Language · device</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Quality</th>
                <th>Version</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r) => (
                <tr key={r.id}>
                  <td className="mono">
                    {r.uid} {r.isTest ? <span className="badge">test</span> : null}
                  </td>
                  <td>{r.vendor?.code ?? (r.interviewer ? `CAPI · ${r.interviewer.name}` : '—')}</td>
                  <td>{[r.language, r.device].filter(Boolean).join(' · ') || '—'}</td>
                  <td>
                    <span className={`badge ${r.status.toLowerCase()}`}>{r.status.toLowerCase()}</span>
                  </td>
                  <td className="mono small">{r.outcomeReason ?? ''}</td>
                  <td>
                    {r.qualityScore ?? '—'}
                    {r.reviewState !== 'NONE' ? (
                      <span className={`badge ${r.reviewState.toLowerCase()}`}> {r.reviewState.toLowerCase()}</span>
                    ) : null}
                  </td>
                  <td>v{r.version.version}</td>
                  <td className="small">{new Date(r.startedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
