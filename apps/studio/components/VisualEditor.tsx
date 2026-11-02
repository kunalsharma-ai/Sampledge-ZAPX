'use client';
/**
 * Structured survey editor. It edits the canonical survey definition directly; the JSON view and
 * this editor are two views of the same object.
 */
import { useState } from 'react';
import type { Option, Page, Question, QuestionType, SurveyDefinition } from '@zapx/survey-schema';

type Selection = { kind: 'survey' } | { kind: 'page'; page: number } | { kind: 'question'; page: number; q: number };

const TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Single choice',
  multi: 'Multiple choice',
  open: 'Open text',
  numeric: 'Numeric',
  grid: 'Grid',
  info: 'Information',
};

function nextId(def: SurveyDefinition, prefix: string): string {
  const used = new Set(def.pages.flatMap((p) => p.questions.map((q) => q.id.toLowerCase())));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`.toLowerCase())) return `${prefix}${i}`;
}

function newQuestion(def: SurveyDefinition, type: QuestionType): Question {
  const id = nextId(def, 'Q');
  const base = { id, text: 'New question', required: true, validations: [] };
  const opts: Option[] = [
    { code: 1, label: 'Option 1' },
    { code: 2, label: 'Option 2' },
  ];
  switch (type) {
    case 'single':
      return { ...base, type, options: opts, randomize: false };
    case 'multi':
      return { ...base, type, options: opts, randomize: false };
    case 'open':
      return { ...base, type, multiline: false, maxLength: 2000 };
    case 'numeric':
      return { ...base, type, integer: true };
    case 'grid':
      return { ...base, type, rows: [{ id: 'r1', label: 'Item 1' }], columns: opts, randomizeRows: false };
    case 'info':
      return { id, type, text: 'Information text' };
  }
}

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = [...arr];
  const [x] = copy.splice(from, 1);
  copy.splice(to, 0, x!);
  return copy;
}

export function VisualEditor({
  def,
  onChange,
  readOnly,
}: {
  def: SurveyDefinition;
  onChange: (d: SurveyDefinition) => void;
  readOnly?: boolean;
}) {
  const [sel, setSel] = useState<Selection>({ kind: 'survey' });
  const [newType, setNewType] = useState<QuestionType>('single');

  const setPages = (pages: Page[]) => onChange({ ...def, pages });
  const setPage = (pi: number, page: Page) => setPages(def.pages.map((p, i) => (i === pi ? page : p)));
  const setQuestion = (pi: number, qi: number, q: Question) =>
    setPage(pi, { ...def.pages[pi]!, questions: def.pages[pi]!.questions.map((x, i) => (i === qi ? q : x)) });

  const addPage = () => {
    const ids = new Set(def.pages.map((p) => p.id));
    let n = def.pages.length + 1;
    while (ids.has(`P${n}`)) n++;
    setPages([...def.pages, { id: `P${n}`, questions: [newQuestion(def, newType)] }]);
    setSel({ kind: 'question', page: def.pages.length, q: 0 });
  };
  const addQuestion = (pi: number) => {
    const page = def.pages[pi]!;
    setPage(pi, { ...page, questions: [...page.questions, newQuestion(def, newType)] });
    setSel({ kind: 'question', page: pi, q: page.questions.length });
  };

  const selected = sel.kind === 'question' ? def.pages[sel.page]?.questions[sel.q] : sel.kind === 'page' ? def.pages[sel.page] : undefined;

  return (
    <div className="editor" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
      <nav className="panel outline" aria-label="Survey outline">
        <button className={`item ${sel.kind === 'survey' ? 'selected' : ''}`} onClick={() => setSel({ kind: 'survey' })}>
          Survey settings, terminations, quotas
        </button>
        {def.pages.map((p, pi) => (
          <div key={pi}>
            <button
              className={`item page ${sel.kind === 'page' && sel.page === pi ? 'selected' : ''}`}
              onClick={() => setSel({ kind: 'page', page: pi })}
            >
              {p.id}
              {p.title ? ` · ${p.title}` : ''}
              {p.condition ? <span className="type">if</span> : null}
            </button>
            {p.questions.map((q, qi) => (
              <button
                key={qi}
                className={`item q ${sel.kind === 'question' && sel.page === pi && sel.q === qi ? 'selected' : ''}`}
                onClick={() => setSel({ kind: 'question', page: pi, q: qi })}
              >
                <span className="mono">{q.id}</span>
                <span className="type">{q.type}</span>
              </button>
            ))}
            {!readOnly ? (
              <button className="link small" style={{ marginLeft: 18 }} onClick={() => addQuestion(pi)}>
                + question
              </button>
            ) : null}
          </div>
        ))}
        {!readOnly ? (
          <div className="stack" style={{ marginTop: 12 }}>
            <label className="field">
              New question type
              <select value={newType} onChange={(e) => setNewType(e.target.value as QuestionType)}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <button onClick={addPage}>+ Add page</button>
          </div>
        ) : null}
      </nav>

      <section className="panel stack">
        <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          {sel.kind === 'survey' ? <SurveySettings def={def} onChange={onChange} /> : null}
          {sel.kind === 'page' && selected ? (
            <PageForm
              page={selected as Page}
              onChange={(p) => setPage(sel.page, p)}
              onMove={(d) => {
                setPages(move(def.pages, sel.page, sel.page + d));
                setSel({ kind: 'page', page: Math.max(0, Math.min(def.pages.length - 1, sel.page + d)) });
              }}
              onDelete={
                def.pages.length > 1
                  ? () => {
                      setPages(def.pages.filter((_, i) => i !== sel.page));
                      setSel({ kind: 'survey' });
                    }
                  : undefined
              }
            />
          ) : null}
          {sel.kind === 'question' && selected ? (
            <QuestionForm
              q={selected as Question}
              onChange={(q) => setQuestion(sel.page, sel.q, q)}
              onMove={(d) => {
                const page = def.pages[sel.page]!;
                setPage(sel.page, { ...page, questions: move(page.questions, sel.q, sel.q + d) });
                setSel({ ...sel, q: Math.max(0, Math.min(page.questions.length - 1, sel.q + d)) });
              }}
              onDelete={
                def.pages[sel.page]!.questions.length > 1
                  ? () => {
                      const page = def.pages[sel.page]!;
                      setPage(sel.page, { ...page, questions: page.questions.filter((_, i) => i !== sel.q) });
                      setSel({ kind: 'page', page: sel.page });
                    }
                  : undefined
              }
            />
          ) : null}
        </fieldset>
      </section>
    </div>
  );
}

function Text({
  label,
  value,
  onChange,
  mono,
  placeholder,
  area,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  mono?: boolean;
  placeholder?: string;
  area?: boolean;
}) {
  return (
    <label className="field">
      {label}
      {area ? (
        <textarea
          rows={3}
          value={value ?? ''}
          placeholder={placeholder}
          style={mono ? undefined : { fontFamily: 'inherit', fontSize: 14 }}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      ) : (
        <input
          className={mono ? 'mono' : undefined}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )}
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        style={{ width: 120 }}
      />
    </label>
  );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

const CONDITION_HELP = 'Logic, e.g. Q1 == 2 and AGE >= 18 · selected(Q3, 1, 2) · Q5.r1 >= 4 · answered(Q2)';

function SurveySettings({ def, onChange }: { def: SurveyDefinition; onChange: (d: SurveyDefinition) => void }) {
  return (
    <>
      <h2>Survey settings</h2>
      <Text label="Title" value={def.title} onChange={(v) => onChange({ ...def, title: v ?? '' })} />
      <Text label="Welcome text (first page)" area value={def.welcome} onChange={(v) => onChange({ ...def, welcome: v })} />
      <Text label="Thank-you text (completes)" area value={def.thankYou} onChange={(v) => onChange({ ...def, thankYou: v })} />
      <div className="row">
        <Check
          label="Allow respondents to go back"
          value={def.settings.allowBack}
          onChange={(v) => onChange({ ...def, settings: { ...def.settings, allowBack: v } })}
        />
        <Check
          label="Show progress bar"
          value={def.settings.showProgress}
          onChange={(v) => onChange({ ...def, settings: { ...def.settings, showProgress: v } })}
        />
      </div>
      <h2 style={{ marginTop: 12 }}>Terminations</h2>
      <p className="muted small">Checked after every page. The first matching rule ends the interview. {CONDITION_HELP}</p>
      <table className="data list-editor">
        <thead>
          <tr>
            <th>ID</th>
            <th>Condition</th>
            <th>Status</th>
            <th>Label</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {def.terminations.map((t, i) => (
            <tr key={i}>
              <td>
                <input
                  className="mono"
                  value={t.id}
                  onChange={(e) =>
                    onChange({ ...def, terminations: def.terminations.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  className="mono"
                  value={t.condition}
                  onChange={(e) =>
                    onChange({ ...def, terminations: def.terminations.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) })
                  }
                />
              </td>
              <td>
                <select
                  value={t.status}
                  onChange={(e) =>
                    onChange({
                      ...def,
                      terminations: def.terminations.map((x, j) => (j === i ? { ...x, status: e.target.value as 'terminate' } : x)),
                    })
                  }
                >
                  <option value="terminate">terminate</option>
                  <option value="quality_fail">quality fail</option>
                </select>
              </td>
              <td>
                <input
                  value={t.label ?? ''}
                  onChange={(e) =>
                    onChange({
                      ...def,
                      terminations: def.terminations.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)),
                    })
                  }
                />
              </td>
              <td>
                <button
                  className="link danger"
                  onClick={() => onChange({ ...def, terminations: def.terminations.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          onClick={() =>
            onChange({
              ...def,
              terminations: [...def.terminations, { id: `T${def.terminations.length + 1}`, condition: 'Q1 == 1', status: 'terminate' }],
            })
          }
        >
          + Termination
        </button>
      </div>
      <h2 style={{ marginTop: 12 }}>Quotas</h2>
      <p className="muted small">
        Respondents matching the condition count toward the target when they complete. Over-target respondents get the quota-full redirect.
      </p>
      <table className="data list-editor">
        <thead>
          <tr>
            <th>ID</th>
            <th>Label</th>
            <th>Condition</th>
            <th>Target</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {def.quotas.map((q, i) => (
            <tr key={i}>
              <td>
                <input
                  className="mono"
                  value={q.id}
                  onChange={(e) => onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })}
                />
              </td>
              <td>
                <input
                  value={q.label ?? ''}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, label: e.target.value || undefined } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  className="mono"
                  value={q.condition}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)) })
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  min={0}
                  value={q.target}
                  style={{ width: 90 }}
                  onChange={(e) =>
                    onChange({ ...def, quotas: def.quotas.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)) })
                  }
                />
              </td>
              <td>
                <button className="link danger" onClick={() => onChange({ ...def, quotas: def.quotas.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button
          onClick={() =>
            onChange({ ...def, quotas: [...def.quotas, { id: `QT${def.quotas.length + 1}`, condition: 'Q1 == 1', target: 100 }] })
          }
        >
          + Quota
        </button>
      </div>
    </>
  );
}

function PageForm({
  page,
  onChange,
  onMove,
  onDelete,
}: {
  page: Page;
  onChange: (p: Page) => void;
  onMove: (d: number) => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <div className="row">
        <h2 style={{ margin: 0 }}>Page {page.id}</h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => onMove(-1)} aria-label="Move page up">
          ↑
        </button>
        <button onClick={() => onMove(1)} aria-label="Move page down">
          ↓
        </button>
        {onDelete ? (
          <button className="danger" onClick={onDelete}>
            Delete page
          </button>
        ) : null}
      </div>
      <Text label="Page ID" mono value={page.id} onChange={(v) => onChange({ ...page, id: v ?? '' })} />
      <Text label="Title (optional)" value={page.title} onChange={(v) => onChange({ ...page, title: v })} />
      <Text
        label="Show this page only if (optional)"
        mono
        value={page.condition}
        placeholder="e.g. Q1 == 1"
        onChange={(v) => onChange({ ...page, condition: v })}
      />
      <p className="muted small">{CONDITION_HELP}. Page conditions can only use questions from earlier pages.</p>
    </>
  );
}

function OptionsEditor({ options, onChange, multi }: { options: Option[]; onChange: (o: Option[]) => void; multi?: boolean }) {
  const set = (i: number, o: Option) => onChange(options.map((x, j) => (j === i ? o : x)));
  return (
    <table className="data list-editor">
      <thead>
        <tr>
          <th style={{ width: 80 }}>Code</th>
          <th>Label</th>
          <th>Anchor</th>
          {multi ? <th>Exclusive</th> : null}
          <th />
        </tr>
      </thead>
      <tbody>
        {options.map((o, i) => (
          <tr key={i}>
            <td>
              <input
                type="number"
                value={o.code}
                style={{ width: 70 }}
                onChange={(e) => set(i, { ...o, code: Number(e.target.value) })}
                aria-label="Answer code"
              />
            </td>
            <td>
              <input value={o.label} onChange={(e) => set(i, { ...o, label: e.target.value })} aria-label="Answer label" />
            </td>
            <td>
              <input
                type="checkbox"
                checked={!!o.anchor}
                onChange={(e) => set(i, { ...o, anchor: e.target.checked || undefined })}
                aria-label="Keep in place when randomizing"
              />
            </td>
            {multi ? (
              <td>
                <input
                  type="checkbox"
                  checked={!!o.exclusive}
                  onChange={(e) => set(i, { ...o, exclusive: e.target.checked || undefined })}
                  aria-label="Exclusive"
                />
              </td>
            ) : null}
            <td>
              <button className="link danger" onClick={() => onChange(options.filter((_, j) => j !== i))} disabled={options.length <= 1}>
                Remove
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={5}>
            <button
              onClick={() => {
                const code = Math.max(0, ...options.filter((o) => o.code < 90).map((o) => o.code)) + 1;
                onChange([...options, { code, label: `Option ${code}` }]);
              }}
            >
              + Option
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function QuestionForm({
  q,
  onChange,
  onMove,
  onDelete,
}: {
  q: Question;
  onChange: (q: Question) => void;
  onMove: (d: number) => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <div className="row">
        <h2 style={{ margin: 0 }}>
          <span className="mono">{q.id}</span> <span className="badge">{TYPE_LABELS[q.type]}</span>
        </h2>
        <div style={{ flex: 1 }} />
        <button onClick={() => onMove(-1)} aria-label="Move question up">
          ↑
        </button>
        <button onClick={() => onMove(1)} aria-label="Move question down">
          ↓
        </button>
        {onDelete ? (
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        ) : null}
      </div>
      <Text label="Variable name" mono value={q.id} onChange={(v) => onChange({ ...q, id: v ?? '' })} />
      <Text
        label="Question text (use {{VAR}} to pipe an earlier answer)"
        area
        value={q.text}
        onChange={(v) => onChange({ ...q, text: v ?? '' })}
      />
      <Text
        label="Show only if (optional)"
        mono
        value={q.condition}
        placeholder="e.g. selected(Q2, 98)"
        onChange={(v) => onChange({ ...q, condition: v })}
      />
      {q.type !== 'info' ? (
        <>
          <Text label="Help text (optional)" value={q.help} onChange={(v) => onChange({ ...q, help: v })} />
          <Check label="Answer required" value={q.required} onChange={(v) => onChange({ ...q, required: v })} />
        </>
      ) : null}
      {q.type === 'single' || q.type === 'multi' ? (
        <>
          <h3>Answer options</h3>
          <OptionsEditor options={q.options} multi={q.type === 'multi'} onChange={(options) => onChange({ ...q, options })} />
          <Check
            label="Randomize order (anchored options stay in place)"
            value={q.randomize}
            onChange={(v) => onChange({ ...q, randomize: v })}
          />
        </>
      ) : null}
      {q.type === 'multi' ? (
        <div className="row">
          <Num label="Minimum selections" value={q.minSelected} onChange={(v) => onChange({ ...q, minSelected: v })} />
          <Num label="Maximum selections" value={q.maxSelected} onChange={(v) => onChange({ ...q, maxSelected: v })} />
        </div>
      ) : null}
      {q.type === 'numeric' ? (
        <div className="row">
          <Num label="Minimum" value={q.min} onChange={(v) => onChange({ ...q, min: v })} />
          <Num label="Maximum" value={q.max} onChange={(v) => onChange({ ...q, max: v })} />
          <Text label="Unit" value={q.unit} onChange={(v) => onChange({ ...q, unit: v })} />
          <Check label="Whole numbers only" value={q.integer} onChange={(v) => onChange({ ...q, integer: v })} />
        </div>
      ) : null}
      {q.type === 'open' ? (
        <div className="row">
          <Check label="Multi-line" value={q.multiline} onChange={(v) => onChange({ ...q, multiline: v })} />
          <Num label="Max characters" value={q.maxLength} onChange={(v) => onChange({ ...q, maxLength: v ?? 2000 })} />
        </div>
      ) : null}
      {q.type === 'grid' ? (
        <>
          <h3>Rows (variables are {q.id}_rowid)</h3>
          <table className="data list-editor">
            <tbody>
              {q.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ width: 100 }}>
                    <input
                      className="mono"
                      value={r.id}
                      aria-label="Row id"
                      onChange={(e) => onChange({ ...q, rows: q.rows.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })}
                    />
                  </td>
                  <td>
                    <input
                      value={r.label}
                      aria-label="Row label"
                      onChange={(e) => onChange({ ...q, rows: q.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                    />
                  </td>
                  <td>
                    <button
                      className="link danger"
                      disabled={q.rows.length <= 1}
                      onClick={() => onChange({ ...q, rows: q.rows.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button
              onClick={() => onChange({ ...q, rows: [...q.rows, { id: `r${q.rows.length + 1}`, label: `Item ${q.rows.length + 1}` }] })}
            >
              + Row
            </button>
          </div>
          <Check label="Randomize rows" value={q.randomizeRows} onChange={(v) => onChange({ ...q, randomizeRows: v })} />
          <h3>Scale columns</h3>
          <OptionsEditor options={q.columns} onChange={(columns) => onChange({ ...q, columns })} />
        </>
      ) : null}
      {q.type !== 'info' ? (
        <>
          <h3>Custom validations</h3>
          <p className="muted small">Each rule must be true for the answer to be accepted.</p>
          <table className="data list-editor">
            <tbody>
              {q.validations.map((v, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="mono"
                      value={v.expr}
                      aria-label="Rule"
                      onChange={(e) =>
                        onChange({ ...q, validations: q.validations.map((x, j) => (j === i ? { ...x, expr: e.target.value } : x)) })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={v.message}
                      aria-label="Message"
                      onChange={(e) =>
                        onChange({ ...q, validations: q.validations.map((x, j) => (j === i ? { ...x, message: e.target.value } : x)) })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="link danger"
                      onClick={() => onChange({ ...q, validations: q.validations.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button
              onClick={() =>
                onChange({ ...q, validations: [...q.validations, { expr: `${q.id} > 0`, message: 'Please check your answer.' }] })
              }
            >
              + Validation
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
