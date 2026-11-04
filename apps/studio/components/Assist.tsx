'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiffItem, SurveyDiff } from '@zapx/logic-engine';
import { api, upload, waitForJob, type Job } from '@/lib/api';
import { JobProgress } from './ExportJobs';
import { ErrorNote } from './Shell';

interface ChangeSetSummary {
  id: string;
  title: string;
  source: 'AI' | 'IMPORT' | 'MANUAL';
  status: 'PROPOSED' | 'APPLIED' | 'REJECTED';
  producer: string;
  sourceFileName: string | null;
  createdAt: string;
}
interface RowReport {
  row: number;
  id: string | null;
  kind: string;
  confidence: number;
  issues: string[];
}
interface ChangeSet extends ChangeSetSummary {
  prompt: string | null;
  diff: SurveyDiff;
  assumptions: string[];
  confidence: { overall?: number; rows?: RowReport[]; summary?: string; attempts?: number } | null;
  check: {
    schemaOk: boolean;
    publishable: boolean;
    analysis: {
      errors: number;
      warnings: number;
      issues: Array<{ severity: string; code: string; message: string; location: string }>;
    } | null;
    qa: {
      passed: boolean;
      coverage: { percent: number };
      outcomes: Record<string, number>;
      defects: Array<{ severity: string; code: string; message: string; location: string }>;
    } | null;
  };
  stale: boolean;
}

/* Minimal typing for the Web Speech API, which TypeScript's DOM library does not include. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * AI Survey Architect and file import. Everything here produces a change set; the draft only
 * changes when a programmer applies one.
 */
export function Assist({
  surveyId,
  language,
  readOnly,
  dirty,
  onApplied,
  initialInstruction = '',
  focusImport = false,
}: {
  surveyId: string;
  language: string;
  readOnly: boolean;
  dirty: boolean;
  onApplied: () => Promise<void>;
  /** Pre-filled instruction (from the dashboard's "Describe it to AI"). */
  initialInstruction?: string;
  /** Scroll to the questionnaire import (from the dashboard's "Import a questionnaire"). */
  focusImport?: boolean;
}) {
  const [ai, setAi] = useState<{ configured: boolean; model: string } | null>(null);
  const [instruction, setInstruction] = useState(initialInstruction);
  const importPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusImport) importPanel.current?.scrollIntoView({ block: 'center' });
  }, [focusImport]);
  const [file, setFile] = useState<File | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [list, setList] = useState<ChangeSetSummary[]>([]);
  const [selected, setSelected] = useState<ChangeSet | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [job, setJob] = useState<Job<unknown> | null>(null);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await api<ChangeSetSummary[]>(`/surveys/${surveyId}/changesets`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void api<{ configured: boolean; model: string }>('/ai/status').then(setAi, setError);
    void loadList();
  }, [loadList]);
  useEffect(() => () => recognizer.current?.stop(), []);

  const open = async (id: string) => {
    setError(null);
    try {
      setSelected(await api<ChangeSet>(`/changesets/${id}`));
    } catch (e) {
      setError(e);
    }
  };

  const after = async (cs: ChangeSet) => {
    await loadList();
    await open(cs.id);
  };

  /** AI drafts run on the job worker, so a slow model call never holds the browser request open. */
  const draftInBackground = async (form: FormData) => {
    const queued = await upload<Job<{ changeSetId: string }>>(`/surveys/${surveyId}/jobs/ai`, form);
    setJob(queued);
    const done = await waitForJob<{ changeSetId: string }>(queued.id, setJob);
    return { id: done.result!.changeSetId } as ChangeSet;
  };

  const propose = async () => {
    setBusy('ai');
    setError(null);
    try {
      const form = new FormData();
      form.append('instruction', instruction);
      if (file) form.append('file', file);
      const cs = await draftInBackground(form);
      setInstruction('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      await after(cs);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      setJob(null);
    }
  };

  const importNow = async () => {
    if (!importFile) return;
    setBusy('import');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', importFile);
      // The template (Excel, CSV) imports exactly and quickly; documents are read by the AI in the background.
      let cs: ChangeSet;
      if (/\.(xlsx|csv)$/i.test(importFile.name)) {
        cs = await upload<ChangeSet>(`/surveys/${surveyId}/import`, form);
      } else {
        form.append('instruction', 'Program this questionnaire as a new survey, replacing the current draft.');
        cs = await draftInBackground(form);
      }
      setImportFile(null);
      if (importInput.current) importInput.current.value = '';
      await after(cs);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      setJob(null);
    }
  };

  const decide = async (action: 'apply' | 'reject') => {
    if (!selected) return;
    setBusy(action);
    setError(null);
    try {
      await api(`/changesets/${selected.id}/${action}`, { method: 'POST' });
      if (action === 'apply') await onApplied();
      await after(selected);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const dictate = () => {
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) {
      setError(new Error('Voice dictation is not available in this browser. Try Chrome or Edge, or type the instruction.'));
      return;
    }
    const r = new Ctor();
    r.lang = language || 'en';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) text += e.results[i]![0].transcript;
      if (text) setInstruction((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${text.trim()}`);
    };
    r.onerror = (e) => setError(new Error(`Dictation stopped: ${e.error}`));
    r.onend = () => setListening(false);
    recognizer.current = r;
    r.start();
    setListening(true);
  };

  const canSpeak = typeof window !== 'undefined' && !!speechRecognition();

  return (
    <div className="editor" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div className="stack">
        {!readOnly ? (
          <div className="grid2">
            <div className="panel stack" data-testid="ai-panel">
              <h2>AI Survey Architect</h2>
              {ai && !ai.configured ? (
                <p className="small" style={{ color: 'var(--warn)' }} data-testid="ai-not-configured">
                  AI is not configured on this server. An administrator needs to set ANTHROPIC_API_KEY. File import below works without it.
                </p>
              ) : (
                <p className="muted small">
                  Describe a new survey or a change, by typing or dictating, and optionally attach a brief or questionnaire (Word, PDF,
                  text). The AI drafts a proposal and lists its assumptions; you review it before anything changes.
                </p>
              )}
              <label className="field">
                Instruction
                <textarea
                  rows={5}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="e.g. Add a region question after gender with North, South, East and West, and a quota of 100 completes per region."
                  style={{ fontFamily: 'inherit', fontSize: 14 }}
                />
              </label>
              <div className="row">
                {canSpeak ? (
                  <button onClick={dictate} aria-pressed={listening} title="Uses your browser's speech recognition service">
                    {listening ? '■ Stop dictation' : '🎙 Dictate'}
                  </button>
                ) : null}
                <input
                  ref={fileInput}
                  type="file"
                  accept=".docx,.pdf,.txt,.md"
                  aria-label="Attach brief or questionnaire"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {listening ? <p className="muted small">Listening… your browser's speech service converts speech to text.</p> : null}
              <div>
                <button className="primary" onClick={propose} disabled={!ai?.configured || busy !== null || (!instruction.trim() && !file)}>
                  {busy === 'ai' ? 'Drafting… (you can leave this page)' : 'Draft proposal'}
                </button>
              </div>
            </div>
            <div className="panel stack" data-testid="import-panel" ref={importPanel}>
              <h2>Import a questionnaire</h2>
              <p className="muted small">
                Excel or CSV in the ZAPX template is imported exactly, with a confidence score per row. Word, PDF and text questionnaires
                are read by the AI.
              </p>
              <a href="/api/imports/template.xlsx" className="small">
                Download the Excel template
              </a>
              <input
                ref={importInput}
                type="file"
                accept=".xlsx,.csv,.docx,.pdf,.txt,.md"
                aria-label="Questionnaire file"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
              <div>
                <button className="primary" onClick={importNow} disabled={!importFile || busy !== null}>
                  {busy === 'import' ? 'Importing…' : 'Import file'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {job ? <JobProgress job={job} /> : null}
        <ErrorNote error={error} />
        {selected ? (
          <Review cs={selected} readOnly={readOnly} dirty={dirty} busy={busy} onDecide={decide} />
        ) : (
          <p className="muted">Select a proposal to review it.</p>
        )}
      </div>
      <aside className="panel">
        <h2>Proposals</h2>
        {list.length === 0 ? <p className="muted small">No proposals yet.</p> : null}
        <div className="stack" style={{ gap: 6 }}>
          {list.map((c) => (
            <button
              key={c.id}
              style={{ textAlign: 'left', fontWeight: 400 }}
              onClick={() => open(c.id)}
              aria-current={selected?.id === c.id}
            >
              <span className={`badge ${c.status === 'APPLIED' ? 'good' : c.status === 'REJECTED' ? 'bad' : 'warn'}`}>
                {c.status.toLowerCase()}
              </span>{' '}
              <span className="badge">{c.source === 'AI' ? 'AI' : c.source === 'IMPORT' ? 'import' : 'pasted'}</span> {c.title}
              <div className="muted small">{new Date(c.createdAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}

const CHANGE_LABEL: Record<DiffItem['change'], string> = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' };

function Review({
  cs,
  readOnly,
  dirty,
  busy,
  onDecide,
}: {
  cs: ChangeSet;
  readOnly: boolean;
  dirty: boolean;
  busy: string | null;
  onDecide: (a: 'apply' | 'reject') => void;
}) {
  const lowRows = (cs.confidence?.rows ?? []).filter((r) => r.confidence < 1 || r.issues.length);
  const canDecide = !readOnly && cs.status === 'PROPOSED';
  return (
    <div className="panel stack" data-testid="changeset-review">
      <div className="row">
        <h2 style={{ margin: 0 }}>{cs.title}</h2>
        <span className={`badge ${cs.status === 'APPLIED' ? 'good' : cs.status === 'REJECTED' ? 'bad' : 'warn'}`}>
          {cs.status.toLowerCase()}
        </span>
      </div>
      <div className="muted small">
        {cs.source === 'AI' ? `Written by ${cs.producer}` : cs.source === 'IMPORT' ? `Imported with ${cs.producer}` : 'Pasted definition'}
        {cs.sourceFileName ? ` from ${cs.sourceFileName}` : ''} · {new Date(cs.createdAt).toLocaleString()}
        {cs.confidence?.attempts === 2 ? ' · the first answer failed validation and was corrected automatically' : ''}
      </div>
      {cs.prompt ? (
        <blockquote className="small" style={{ margin: 0, paddingLeft: 10, borderLeft: '3px solid var(--border)' }}>
          {cs.prompt}
        </blockquote>
      ) : null}
      {cs.confidence?.summary ? <p>{cs.confidence.summary}</p> : null}

      {cs.assumptions.length ? (
        <div>
          <h3>Please confirm</h3>
          <ul className="small" data-testid="assumptions">
            {cs.assumptions.map((a, n) => (
              <li key={n}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {typeof cs.confidence?.overall === 'number' ? (
        <div>
          <h3>Import confidence: {Math.round(cs.confidence.overall * 100)}%</h3>
          {lowRows.length ? (
            <table className="data small">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Item</th>
                  <th>Confidence</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {lowRows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td className="mono">
                      {r.id ?? '—'} <span className="muted">{r.kind}</span>
                    </td>
                    <td>{Math.round(r.confidence * 100)}%</td>
                    <td>{r.issues.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ok-text small">Every row was read without guessing.</p>
          )}
        </div>
      ) : null}

      <div>
        <h3>
          Changes: {cs.diff.counts.added} added, {cs.diff.counts.changed} changed, {cs.diff.counts.removed} removed, {cs.diff.counts.moved}{' '}
          moved
        </h3>
        {cs.diff.affectsData ? (
          <p className="small" style={{ color: 'var(--warn)' }}>
            This changes question ids, types or answer codes. Data collected on earlier versions will not line up for those questions.
          </p>
        ) : null}
        <table className="data small" data-testid="diff">
          <tbody>
            {cs.diff.items.map((i, n) => (
              <tr key={n}>
                <td>
                  <span className={`badge ${i.change === 'removed' ? 'bad' : i.change === 'added' ? 'good' : 'warn'}`}>
                    {CHANGE_LABEL[i.change]}
                  </span>
                </td>
                <td className="mono">{i.entity}</td>
                <td>
                  {i.summary}
                  {i.change === 'changed' && i.before !== undefined ? (
                    <details>
                      <summary>Before / after</summary>
                      <div className="grid2">
                        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(i.before, null, 1)}
                        </pre>
                        <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(i.after, null, 1)}
                        </pre>
                      </div>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
            {cs.diff.items.length === 0 ? (
              <tr>
                <td className="muted">No differences from the draft it was based on.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div>
        <h3>Checks on the proposal</h3>
        <p className={cs.check.publishable ? 'ok-text' : 'error-text'}>
          Logic check:{' '}
          {cs.check.analysis ? `${cs.check.analysis.errors} error(s), ${cs.check.analysis.warnings} warning(s)` : 'definition invalid'}
          {cs.check.qa
            ? ` · QA (${cs.check.qa.outcomes ? Object.values(cs.check.qa.outcomes).reduce((a, b) => a + b, 0) : 0} simulated): ${cs.check.qa.passed ? 'passed' : 'failed'}, ${cs.check.qa.coverage.percent}% coverage`
            : ''}
        </p>
        {[...(cs.check.analysis?.issues ?? []), ...(cs.check.qa?.defects ?? [])].slice(0, 30).map((i, n) => (
          <div key={n} className={`issue ${i.severity}`}>
            <div>{i.message}</div>
            <div className="loc">
              {i.code} · {i.location}
            </div>
          </div>
        ))}
      </div>

      {canDecide ? (
        <div className="stack">
          {cs.stale ? (
            <p className="error-text small">
              The draft has changed since this proposal was made, so it can no longer be applied. Create a new proposal.
            </p>
          ) : null}
          {dirty ? (
            <p className="small" style={{ color: 'var(--warn)' }}>
              Save or discard your unsaved edits before applying a proposal.
            </p>
          ) : null}
          <div className="row">
            <button className="primary" onClick={() => onDecide('apply')} disabled={busy !== null || cs.stale || dirty}>
              {busy === 'apply' ? 'Applying…' : 'Apply to draft'}
            </button>
            <button className="danger" onClick={() => onDecide('reject')} disabled={busy !== null}>
              Reject
            </button>
            <span className="muted small">Applying replaces the draft. You can still edit it and nothing goes live until you publish.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
