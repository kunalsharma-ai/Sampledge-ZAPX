'use client';
/**
 * Professional Programmer workspace (blueprint phase 1). Works on the same canonical definition as
 * the Visual Builder: the XML here is generated from it and applied back through the same schema
 * and logic check, so switching between the two never loses logic. Unsupported constructs are
 * listed, never dropped silently.
 */
import { useEffect, useMemo, useState } from 'react';
import { Bug, Download, FileCode2, GitCompareArrows, Network, Upload, Wand2 } from 'lucide-react';
import type { ElementSpec } from '@codemirror/lang-xml';
import {
  analyzeSurvey,
  dependencyGraph,
  diffSurveys,
  fromDecipherStyleXml,
  fromZapxXml,
  simulateSurvey,
  toZapxXml,
  traceExpression,
  traceRoute,
  XmlError,
  type MigrationResult,
  type SurveyDiff,
} from '@zapx/logic-engine';
import { parseSurveyDefinition, type Answers, type SurveyDefinition } from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { SaveTestCase } from './TestCases';
import { CodeEditor, type LintMessage } from './CodeEditor';
import { InfoTip } from '@/components/neon/InfoTip';

type Pane = 'xml' | 'debug' | 'deps' | 'history' | 'migrate';

const QUESTION_ATTRS = ['id', 'cond', 'required', 'randomize'];
const XML_ELEMENTS: ElementSpec[] = [
  {
    name: 'survey',
    top: true,
    attributes: ['schemaVersion', 'title', 'language'],
    children: ['welcome', 'thankYou', 'settings', 'variable', 'recode', 'clean', 'page', 'loop', 'block', 'termination', 'quota'],
  },
  {
    name: 'page',
    attributes: ['id', 'title', 'cond'],
    children: [
      'single',
      'multi',
      'open',
      'numeric',
      'grid',
      'scale',
      'ranking',
      'sum',
      'cardsort',
      'hotspot',
      'photo',
      'signature',
      'barcode',
      'eyetrack',
      'info',
    ],
  },
  ...['single', 'multi', 'ranking'].map((name) => ({
    name,
    attributes: [...QUESTION_ATTRS, 'minSelected', 'maxSelected', 'rankCount'],
    children: ['text', 'help', 'option', 'optionsFrom', 'media', 'validate'],
  })),
  { name: 'open', attributes: [...QUESTION_ATTRS, 'multiline', 'maxLength'], children: ['text', 'help', 'validate', 'media'] },
  {
    name: 'numeric',
    attributes: [...QUESTION_ATTRS, 'min', 'max', 'integer', 'unit', 'display', 'step', 'minLabel', 'maxLabel'],
    children: ['text', 'help', 'validate', 'media'],
  },
  {
    name: 'scale',
    attributes: [...QUESTION_ATTRS, 'min', 'max', 'nps', 'minLabel', 'maxLabel'],
    children: ['text', 'help', 'dontKnow', 'validate', 'media'],
  },
  { name: 'grid', attributes: [...QUESTION_ATTRS, 'randomizeRows'], children: ['text', 'help', 'row', 'col', 'validate', 'media'] },
  { name: 'sum', attributes: [...QUESTION_ATTRS, 'total', 'integer', 'unit'], children: ['text', 'help', 'option', 'validate'] },
  { name: 'cardsort', attributes: [...QUESTION_ATTRS, 'allowUnsorted'], children: ['text', 'help', 'option', 'group', 'validate'] },
  {
    name: 'hotspot',
    attributes: [...QUESTION_ATTRS, 'image', 'imageAlt', 'minSelected', 'maxSelected'],
    children: ['text', 'help', 'region', 'validate'],
  },
  {
    name: 'eyetrack',
    attributes: [...QUESTION_ATTRS, 'image', 'imageAlt', 'durationSec', 'maxErrorPct', 'consentText'],
    children: ['text', 'help', 'aoi'],
  },
  { name: 'photo', attributes: QUESTION_ATTRS, children: ['text', 'help'] },
  { name: 'signature', attributes: QUESTION_ATTRS, children: ['text', 'help'] },
  {
    name: 'maxdiff',
    attributes: [...QUESTION_ATTRS, 'itemsPerSet', 'sets', 'versions', 'bestLabel', 'worstLabel'],
    children: ['text', 'help', 'option'],
  },
  {
    name: 'conjoint',
    attributes: [...QUESTION_ATTRS, 'tasks', 'conceptsPerTask', 'versions', 'noneOption', 'noneLabel'],
    children: ['text', 'help', 'attribute'],
  },
  { name: 'attribute', attributes: ['id', 'label'], children: ['level'] },
  { name: 'level', attributes: ['code'] },
  { name: 'barcode', attributes: [...QUESTION_ATTRS, 'pattern', 'maxLength'], children: ['text', 'help'] },
  { name: 'info', attributes: ['id', 'cond'], children: ['text', 'media'] },
  { name: 'option', attributes: ['code', 'anchor', 'exclusive', 'image'] },
  { name: 'row', attributes: ['id'] },
  { name: 'col', attributes: ['code'] },
  // Card sort group (label as text) or recode group (label, values "1|2" or a min/max range).
  { name: 'group', attributes: ['code', 'label', 'values', 'min', 'max'] },
  { name: 'region', attributes: ['code', 'x', 'y', 'w', 'h'] },
  { name: 'aoi', attributes: ['code', 'x', 'y', 'w', 'h'] },
  { name: 'optionsFrom', attributes: ['question', { name: 'include', values: ['selected', 'not_selected'] }] },
  { name: 'validate', attributes: ['message'] },
  { name: 'variable', attributes: ['id', 'label'] },
  { name: 'recode', attributes: ['id', 'label', 'source'], children: ['group', 'otherwise'] },
  // Blueprint phase 5: cleaning rule; the condition (when) is the element text.
  { name: 'clean', attributes: ['id', 'label', 'question', 'action', 'value', 'method'], children: [] },
  { name: 'otherwise', attributes: ['code', 'label'] },
  { name: 'loop', attributes: ['id', 'label', 'pages', 'source'], children: ['item'] },
  { name: 'item', attributes: ['code'] },
  { name: 'block', attributes: ['id', 'label', 'pages', 'randomize', 'pick'] },
  { name: 'termination', attributes: ['id', { name: 'status', values: ['terminate', 'quality_fail'] }, 'label'] },
  { name: 'quota', attributes: ['id', 'label', 'target', 'group'] },
];

/** Problems in an XML text, by line: reader errors, unknown parts, schema and logic issues. */
function lintXml(text: string): { messages: LintMessage[]; definition: SurveyDefinition | null } {
  try {
    const read = fromZapxXml(text);
    const messages: LintMessage[] = read.warnings.map((w) => ({ line: w.line, message: w.message, severity: 'warning' }));
    const parsed = parseSurveyDefinition(read.definition);
    if (!parsed.ok) {
      for (const i of parsed.issues)
        messages.push({ line: lineOf(text, i.path), message: `${i.path || 'survey'}: ${i.message}`, severity: 'error' });
      return { messages, definition: null };
    }
    for (const i of analyzeSurvey(parsed.definition).issues)
      messages.push({ line: lineOf(text, i.location), message: i.message, severity: i.severity });
    return { messages, definition: parsed.definition };
  } catch (e) {
    if (e instanceof XmlError) return { messages: [{ line: e.line, message: e.message, severity: 'error' }], definition: null };
    throw e;
  }
}

/** Best line for a location such as "pages.P2.questions.Q5.condition": the line that declares the last id. */
function lineOf(text: string, location: string): number {
  const ids = location
    .split('.')
    .filter(
      (p) =>
        /^[A-Za-z][\w-]*$/.test(p) &&
        ![
          'pages',
          'questions',
          'condition',
          'validations',
          'options',
          'settings',
          'quality',
          'checks',
          'terminations',
          'quotas',
          'variables',
          'loops',
          'blocks',
          'expr',
          'optionsFrom',
        ].includes(p),
    );
  const lines = text.split('\n');
  for (const id of ids.reverse()) {
    const i = lines.findIndex((l) => l.includes(`id="${id}"`));
    if (i >= 0) return i + 1;
  }
  return 1;
}

export function Programmer({
  surveyId,
  def,
  onApply,
  readOnly,
}: {
  surveyId: string;
  def: SurveyDefinition;
  onApply: (d: SurveyDefinition) => void;
  readOnly?: boolean;
}) {
  const [pane, setPane] = useState<Pane>('xml');
  const panes: Array<[Pane, string, typeof FileCode2]> = [
    ['xml', 'XML editor', FileCode2],
    ['debug', 'Debugger', Bug],
    ['deps', 'Dependencies', Network],
    ['history', 'Versions & diff', GitCompareArrows],
    ['migrate', 'Migrate', Wand2],
  ];
  return (
    <div className="stack programmer" data-testid="programmer">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="segmented" role="tablist" aria-label="Programmer tools">
          {panes.map(([k, label, Icon]) => (
            <button key={k} role="tab" aria-selected={pane === k} onClick={() => setPane(k)}>
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        {!readOnly ? <SaveSurveyToBank def={def} /> : null}
      </div>
      {pane === 'xml' ? <XmlPane def={def} onApply={onApply} readOnly={readOnly} /> : null}
      {pane === 'debug' ? <DebugPane def={def} surveyId={surveyId} readOnly={readOnly} /> : null}
      {pane === 'deps' ? <DependencyPane def={def} /> : null}
      {pane === 'history' ? <HistoryPane surveyId={surveyId} current={def} onApply={onApply} readOnly={readOnly} /> : null}
      {pane === 'migrate' ? <MigratePane onApply={onApply} readOnly={readOnly} /> : null}
    </div>
  );
}

/** Save the whole draft as an organization template in the question bank. */
function SaveSurveyToBank({ def }: { def: SurveyDefinition }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    const name = window.prompt('Title for this survey in the question bank', def.title);
    if (!name?.trim()) return;
    setState('saving');
    setError(null);
    try {
      await api('/library', { body: { kind: 'SURVEY', name: name.trim(), category: 'Survey template', content: def } });
      setState('saved');
    } catch (e) {
      setError(e);
      setState('idle');
    }
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      {state === 'saved' ? <span className="muted small">Saved to the question bank</span> : null}
      <ErrorNote error={error} />
      <button type="button" disabled={state === 'saving'} onClick={() => void save()}>
        {state === 'saving' ? 'Saving…' : 'Save survey to question bank'}
      </button>
    </div>
  );
}

function XmlPane({ def, onApply, readOnly }: { def: SurveyDefinition; onApply: (d: SurveyDefinition) => void; readOnly?: boolean }) {
  const source = useMemo(() => toZapxXml(def), [def]);
  const [text, setText] = useState(source);
  const [base, setBase] = useState(source);
  if (base !== source) {
    // The survey changed elsewhere (Visual Builder, AI): show the new XML.
    setBase(source);
    setText(source);
  }
  const check = useMemo(() => lintXml(text), [text]);
  const errors = check.messages.filter((m) => m.severity === 'error').length;
  const changed = text !== source;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
    const a = Object.assign(document.createElement('a'), {
      href: url,
      download: `${def.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'survey'}.sampcode.xml`,
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="panel stack">
      <p className="muted small">
        The survey as SampCode XML. Edit it with autocomplete (Ctrl+Space), then apply: the change goes through the same checks as the
        Visual Builder, so the two always show the same survey. Unknown elements and attributes are listed, never dropped silently.
      </p>
      <CodeEditor
        language="xml"
        value={text}
        onChange={setText}
        elements={XML_ELEMENTS}
        lint={(t) => lintXml(t).messages}
        readOnly={readOnly}
        label="Survey XML"
      />
      <div className="row">
        <span className={errors ? 'error-text small' : 'muted small'} data-testid="xml-status">
          {errors ? `${errors} error(s) to fix before applying` : changed ? 'Ready to apply' : 'In sync with the survey'}
          {check.messages.length - errors ? ` · ${check.messages.length - errors} warning(s)` : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={download}>
          <Download size={14} aria-hidden="true" /> Download XML
        </button>
        {!readOnly ? (
          <>
            <button onClick={() => setText(source)} disabled={!changed}>
              Discard changes
            </button>
            <button
              className="primary"
              disabled={!changed || !check.definition}
              onClick={() => check.definition && onApply(check.definition)}
            >
              Apply XML
            </button>
          </>
        ) : null}
      </div>
      {check.messages.length ? (
        <ul className="lint-list">
          {check.messages.slice(0, 50).map((m, i) => (
            <li key={i} className={`issue ${m.severity}`}>
              <span className="mono small">line {m.line}</span> {m.message}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DebugPane({ def, surveyId, readOnly }: { def: SurveyDefinition; surveyId: string; readOnly?: boolean }) {
  const sample = useMemo(() => {
    try {
      return simulateSurvey(def, { respondents: 1, seed: 'debug' }).samples[0]?.answers ?? {};
    } catch {
      return {};
    }
  }, [def]);
  const [answersText, setAnswersText] = useState(() => JSON.stringify(sample, null, 2));
  const [expr, setExpr] = useState(def.quotas[0]?.condition ?? def.pages.find((p) => p.condition)?.condition ?? '');
  let answers: Answers | null = null;
  let answersError: string | null = null;
  try {
    const parsed: unknown = JSON.parse(answersText || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Use an object such as {"Q1": 2}');
    answers = parsed as Answers;
  } catch (e) {
    answersError = (e as Error).message;
  }
  const trace = answers && expr.trim() ? traceExpression(def, expr, answers) : null;
  const route = answers ? traceRoute(def, answers) : null;
  return (
    <div className="grid2 debug-pane">
      <section className="panel stack">
        <h2>
          Test answers
          <InfoTip k="section.testAnswers" />
        </h2>
        <p className="muted small">A simulated respondent to start from. Edit any answer; everything on the right updates.</p>
        <CodeEditor language="json" value={answersText} onChange={setAnswersText} label="Test answers JSON" />
        {answersError ? <p className="error-text small">{answersError}</p> : null}
        <button onClick={() => setAnswersText(JSON.stringify(sample, null, 2))}>Reset to the simulated respondent</button>
      </section>
      <section className="panel stack">
        <h2>
          Expression
          <InfoTip k="section.expression" />
        </h2>
        <label className="field">
          Evaluate
          <input className="mono" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="e.g. AGE >= 18 and selected(Q3, 2)" />
        </label>
        {trace ? (
          trace.ok ? (
            <>
              <p data-testid="debug-value">
                Result: <strong className="mono">{JSON.stringify(trace.value)}</strong>{' '}
                <span className={`badge ${trace.truthy ? 'complete' : 'terminate'}`}>{trace.truthy ? 'true' : 'false'}</span>
              </p>
              <h3>Variable inspector</h3>
              <table className="data">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.inputs.map((i) => (
                    <tr key={`${i.name}.${i.member ?? ''}`}>
                      <td className="mono">{i.member ? `${i.name}.${i.member}` : i.name}</td>
                      <td className="mono">{i.known ? JSON.stringify(i.value) : <span className="error-text">not in this survey</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="error-text small">
              {trace.error?.message} (character {(trace.error?.position ?? 0) + 1})
            </p>
          )
        ) : null}
        <h3>Route for these answers</h3>
        {route ? (
          <>
            <ol className="route">
              {route.steps.map((s) => (
                <li key={s.pageId} className={s.shown ? '' : 'muted'}>
                  <span className="mono">{s.pageId}</span> {s.shown ? 'shown' : `skipped: ${s.reason}`}
                </li>
              ))}
            </ol>
            <p data-testid="debug-ending">
              Ends as: <strong>{route.ending}</strong>
            </p>
            {!readOnly && answers ? <SaveTestCase surveyId={surveyId} def={def} answers={answers} /> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function DependencyPane({ def }: { def: SurveyDefinition }) {
  const graph = useMemo(() => dependencyGraph(def), [def]);
  const [filter, setFilter] = useState('');
  const shown = graph.filter((n) => !filter || n.id.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="panel stack">
      <div className="row">
        <h2 style={{ margin: 0 }}>
          Dependency explorer
          <InfoTip k="section.dependencies" />
        </h2>
        <div style={{ flex: 1 }} />
        <input aria-label="Filter variables" placeholder="Filter variables" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="muted small">
        What each question and calculated variable reads, and everything that reads it. Check here before renaming or deleting.
      </p>
      <table className="data" data-testid="dependency-table">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Uses</th>
            <th>Used by</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((n) => (
            <tr key={n.id}>
              <td>
                <span className="mono">{n.id}</span> <span className="badge">{n.kind}</span>
                {n.pageId ? <span className="muted small"> · {n.pageId}</span> : null}
              </td>
              <td className="mono small">{n.uses.join(', ') || '—'}</td>
              <td className="small">
                {n.usedBy.length ? (
                  n.usedBy.map((u, i) => (
                    <div key={i}>
                      <span className="mono">{u.location}</span> <span className="muted">({u.what})</span>
                    </div>
                  ))
                ) : (
                  <span className="muted">nothing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface VersionRow {
  id: string;
  version: number;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  createdBy: string | null;
  responses: number;
}

function HistoryPane({
  surveyId,
  current,
  onApply,
  readOnly,
}: {
  surveyId: string;
  current: SurveyDefinition;
  onApply: (d: SurveyDefinition) => void;
  readOnly?: boolean;
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [from, setFrom] = useState<number | null>(null);
  const [diff, setDiff] = useState<{ title: string; diff: SurveyDiff; def: SurveyDefinition } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<VersionRow[]>(`/surveys/${surveyId}/versions`).then(setRows, (e: Error) => setError(e.message));
  }, [surveyId]);
  const compare = async (version: number) => {
    setFrom(version);
    try {
      const v = await api<{ definition: unknown }>(`/surveys/${surveyId}/versions/${version}`);
      const parsed = parseSurveyDefinition(v.definition);
      if (!parsed.ok) return setError(`Version ${version} could not be read.`);
      setDiff({
        title: `Version ${version} → the draft you are editing`,
        diff: diffSurveys(parsed.definition, current),
        def: parsed.definition,
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="panel stack">
      <h2>
        Versions &amp; diff
        <InfoTip k="section.versions" />
      </h2>
      <p className="muted small">
        Every published version is kept unchanged. Compare any of them with the draft, or load one back into the draft.
      </p>
      {error ? <p className="error-text">{error}</p> : null}
      <table className="data" data-testid="version-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Published</th>
            <th>By</th>
            <th>Responses</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r) => (
            <tr key={r.id} aria-selected={from === r.version}>
              <td>v{r.version}</td>
              <td>
                <span className="badge">{r.status.toLowerCase()}</span>
              </td>
              <td>{r.publishedAt ? new Date(r.publishedAt).toLocaleString() : '—'}</td>
              <td>{r.createdBy ?? '—'}</td>
              <td>{r.responses}</td>
              <td>
                {r.status !== 'DRAFT' ? (
                  <button className="small" onClick={() => void compare(r.version)}>
                    Compare with draft
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {diff ? (
        <div className="stack" data-testid="version-diff">
          <h3>{diff.title}</h3>
          {diff.diff.items.length === 0 ? (
            <p className="muted">No differences.</p>
          ) : (
            <>
              <p className="small">
                {diff.diff.counts.added} added · {diff.diff.counts.changed} changed · {diff.diff.counts.removed} removed ·{' '}
                {diff.diff.counts.moved} moved
                {diff.diff.affectsData ? <strong className="error-text"> · changes stored data</strong> : null}
              </p>
              <ul className="diff-list">
                {diff.diff.items.map((i, n) => (
                  <li key={n} className={`diff-${i.change}`}>
                    <span className="badge">{i.change}</span> {i.summary}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!readOnly ? (
            <div>
              <button onClick={() => onApply(diff.def)}>Load version {from} into the draft</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MigratePane({ onApply, readOnly }: { onApply: (d: SurveyDefinition) => void; readOnly?: boolean }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<(MigrationResult & { parsed: ReturnType<typeof parseSurveyDefinition> }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const convert = (src: string) => {
    setError(null);
    try {
      const r = fromDecipherStyleXml(src);
      setResult({ ...r, parsed: parseSurveyDefinition(r.definition) });
    } catch (e) {
      setResult(null);
      setError(e instanceof XmlError ? `Line ${e.line}: ${e.message}` : (e as Error).message);
    }
  };
  return (
    <section className="panel stack">
      <h2>
        Migrate a Decipher-style XML survey
        <InfoTip k="section.xmlMigrate" />
      </h2>
      <p className="muted small">
        Converts question types (radio, checkbox, select, text, number, html), rows and columns, page breaks and simple conditions such as
        Q1.r2. Python code, styles, loops, quotas and complex conditions are listed below for you to rebuild; nothing is dropped without a
        note. Check the result in the Visual Builder and the QA lab before publishing.
      </p>
      <label className="field">
        Paste the XML, or choose a file
        <input
          type="file"
          accept=".xml,text/xml,application/xml"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const t = await f.text();
            setText(t);
            convert(t);
          }}
        />
      </label>
      <CodeEditor language="xml" value={text} onChange={setText} label="XML to migrate" />
      <div className="row">
        <button className="primary" onClick={() => convert(text)} disabled={!text.trim()}>
          <Upload size={14} aria-hidden="true" /> Convert
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {result ? (
        <div className="stack" data-testid="migration-result">
          <p>
            Converted {result.converted.questions} questions on {result.converted.pages} pages, {result.converted.conditions} conditions and{' '}
            {result.converted.terminations} terminations. {result.warnings.length} item(s) need attention.
          </p>
          {result.warnings.length ? (
            <ul className="lint-list">
              {result.warnings.map((w, i) => (
                <li key={i} className="issue warning">
                  <span className="mono small">line {w.line}</span> {w.message}
                </li>
              ))}
            </ul>
          ) : null}
          {!result.parsed.ok ? (
            <p className="error-text">
              The converted survey is incomplete: {result.parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}
            </p>
          ) : !readOnly ? (
            <div>
              <button onClick={() => result.parsed.ok && onApply(result.parsed.definition)}>
                Replace the draft with the converted survey
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
