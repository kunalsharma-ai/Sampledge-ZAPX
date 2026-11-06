'use client';
/**
 * AI research assistant (blueprint phase 4). SampCode computes the tables; the AI only reads them and
 * must cite a table for every finding. The tables are always shown next to the answer so a
 * researcher can check each statement.
 */
import { useEffect, useState } from 'react';
import type { Variable } from '@zapx/analysis-core';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { InfoTip } from '@/components/neon/InfoTip';

interface Table {
  id: string;
  variable: string;
  title: string;
  text: string;
}
interface Answer {
  answer: string;
  findings: Array<{ statement: string; tables: string[] }>;
  caveats: string[];
  tables: Table[];
  total: number;
  model: string;
  redactions: number;
}

export function ResearchAssistant({ surveyId, aiConfigured }: { surveyId: string; aiConfigured: boolean }) {
  const [vars, setVars] = useState<Variable[]>([]);
  const [question, setQuestion] = useState('');
  const [banner, setBanner] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [out, setOut] = useState<Answer | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ variables: Variable[] }>(`/surveys/${surveyId}/analysis/variables`).then(
      (v) => setVars(v.variables),
      () => undefined,
    );
  }, [surveyId]);

  const body = () => ({
    question,
    filters: { statuses: ['COMPLETE'] },
    ...(banner ? { banner } : {}),
    ...(picked.length ? { variables: picked } : {}),
  });
  const preview = async () => {
    setBusy(true);
    setError(null);
    try {
      setTables((await api<{ tables: Table[] }>(`/surveys/${surveyId}/analysis/assistant/tables`, { body: body() })).tables);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Answer>(`/surveys/${surveyId}/analysis/assistant`, { body: body() });
      setOut(r);
      setTables(r.tables);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const tableById = (id: string) => (out?.tables ?? tables ?? []).find((t) => t.id === id);
  const choices = vars.filter((v) => v.source !== 'system' && v.kind !== 'open');

  return (
    <section className="panel stack" aria-labelledby="assistant-h" data-testid="research-assistant">
      <h2 id="assistant-h">
        Research assistant
        <InfoTip k="section.assistant" />
      </h2>
      <p className="muted small">
        Ask a question about the completes. SampCode computes the tables (the same frequencies and crosstabs as above) and the AI reads only
        those tables; every finding cites the table it comes from. Open answers are never sent. Check findings against the tables before you
        report them.
      </p>
      {!aiConfigured ? (
        <p className="note">
          AI is not configured on this server, so you can see the tables but not ask. An administrator sets the AI key in settings.
        </p>
      ) : null}
      <label className="field">
        Question
        <textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Which groups are most satisfied, and why might that be?"
        />
      </label>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className="field">
          Compare by (banner)
          <select value={banner} onChange={(e) => setBanner(e.target.value)}>
            <option value="">No banner (frequencies)</option>
            {vars
              .filter((v) => v.kind === 'single' || v.kind === 'multi')
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}: {v.label}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Tables for ({picked.length ? `${picked.length} chosen` : 'first 20 questions'})
          <select
            multiple
            size={4}
            value={picked}
            onChange={(e) => setPicked([...e.target.selectedOptions].map((o) => o.value).slice(0, 20))}
          >
            {choices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}: {v.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button onClick={() => void preview()} disabled={busy}>
          Show the tables it reads
        </button>
        <button className="primary" onClick={() => void ask()} disabled={busy || !aiConfigured || question.trim().length < 3}>
          {busy ? 'Working…' : 'Ask'}
        </button>
      </div>
      <ErrorNote error={error} />
      {out ? (
        <article className="stack" data-testid="assistant-answer">
          <p>{out.answer}</p>
          {out.findings.length ? (
            <ul>
              {out.findings.map((f, i) => (
                <li key={i}>
                  {f.statement}{' '}
                  {f.tables.map((t) => (
                    <button
                      key={t}
                      className="link small mono"
                      onClick={() => setOpen(open === t ? null : t)}
                      aria-label={`Show table ${t}`}
                    >
                      [{t}]
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
          {out.caveats.length ? (
            <ul className="small muted" aria-label="Caveats">
              {out.caveats.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
          <p className="small muted">
            AI-written by {out.model} from {out.total.toLocaleString()} completes
            {out.redactions ? `; ${out.redactions} personal detail(s) removed from your question` : ''}.
          </p>
          {open && tableById(open) ? (
            <pre className="small" data-testid="assistant-cited-table">
              {tableById(open)!.title}
              {'\n'}
              {tableById(open)!.text}
            </pre>
          ) : null}
        </article>
      ) : null}
      {tables ? (
        <details data-testid="assistant-tables" open={!out}>
          <summary>
            {tables.length} table{tables.length === 1 ? '' : 's'} sent to the AI
          </summary>
          {tables.map((t) => (
            <pre key={t.id} className="small">
              {t.id} · {t.title}
              {'\n'}
              {t.text}
            </pre>
          ))}
        </details>
      ) : null}
    </section>
  );
}
