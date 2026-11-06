'use client';
/**
 * Survey flow editors (blueprint phase 1): loops, randomized blocks, calculated variables, the
 * interlocking quota table builder, dynamic answer lists, card sort and image hot-spot questions.
 * Like the rest of the Visual Builder they edit the canonical definition directly, so the Code
 * workspace, the AI and every other view see the same thing.
 */
import { useRef, useState } from 'react';
import type { HotspotRegion, Option, Question, SurveyDefinition } from '@zapx/survey-schema';
import { quotaDimensions, quotaTableCells, quotasFromCells, type QuotaDimension } from '@zapx/logic-engine';
import { OptionImagePicker, mediaSrc, useHasMediaLibrary } from './MediaLibrary';
import { InfoTip } from '@/components/neon/InfoTip';

type Def = SurveyDefinition;
const LOGIC_HELP = 'Logic, e.g. AGE >= 18 and selected(Q3, 1) · KIDS + 2 · round(SPEND / 12, 1)';

function choiceQuestions(def: Def) {
  return def.pages.flatMap((p) =>
    p.questions.filter((q): q is Extract<Question, { type: 'single' | 'multi' }> => q.type === 'single' || q.type === 'multi'),
  );
}

// ---- Loops ------------------------------------------------------------------------------------

export function LoopsEditor({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const loops = def.loops ?? [];
  const set = (i: number, patch: Partial<Def['loops'][number]>) =>
    onChange({ ...def, loops: loops.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const sources = choiceQuestions(def);
  return (
    <section className="stack" aria-labelledby="loops-h">
      <h2 id="loops-h" style={{ marginTop: 12 }}>
        Loops
        <InfoTip k="section.loops" />
      </h2>
      <p className="muted small">
        Ask a run of pages once per item (for example once per brand chosen). Each pass stores its own variables, such as RATE_3 for item 3.
        In those pages, {'{{LOOP}}'} shows the item&apos;s name and LOOP in logic is its code (use your loop&apos;s id).
      </p>
      {loops.map((l, i) => (
        <div key={i} className="panel stack flow-card" data-testid={`loop-${l.id}`}>
          <div className="row">
            <label className="field">
              Loop id
              <input className="mono" value={l.id} onChange={(e) => set(i, { id: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}>
              Pages (in order, comma separated)
              <input
                className="mono"
                value={l.pages.join(', ')}
                onChange={(e) =>
                  set(i, {
                    pages: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <button className="link danger" onClick={() => onChange({ ...def, loops: loops.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
          <label className="field">
            Loop over
            <select
              value={l.source ?? ''}
              onChange={(e) => set(i, e.target.value ? { source: e.target.value, items: [] } : { source: undefined })}
              aria-label="Loop over"
            >
              <option value="">A fixed list (below)</option>
              {sources.map((q) => (
                <option key={q.id} value={q.id}>
                  The options chosen at {q.id}
                </option>
              ))}
            </select>
          </label>
          {!l.source ? (
            <ItemsEditor
              items={l.items}
              onChange={(items) => set(i, { items: items.map((o) => ({ code: Math.max(0, o.code), label: o.label })) })}
            />
          ) : (
            <p className="muted small">One pass for each option chosen at {l.source}; options not chosen are skipped.</p>
          )}
        </div>
      ))}
      <div>
        <button
          onClick={() => {
            const last = def.pages[def.pages.length - 1]!;
            onChange({
              ...def,
              loops: [...loops, { id: `LOOP${loops.length + 1}`, pages: [last.id], items: [{ code: 1, label: 'Item 1' }] }],
            });
          }}
        >
          + Loop
        </button>
      </div>
    </section>
  );
}

function ItemsEditor({ items, onChange }: { items: Option[]; onChange: (o: Option[]) => void }) {
  return (
    <table className="data list-editor">
      <tbody>
        {items.map((it, i) => (
          <tr key={i}>
            <td style={{ width: 90 }}>
              <input
                type="number"
                min={0}
                value={it.code}
                aria-label="Item code"
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, code: Number(e.target.value) } : x)))}
              />
            </td>
            <td>
              <input
                value={it.label}
                aria-label="Item label"
                onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
            </td>
            <td>
              <button className="link danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                Remove
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={3}>
            <button
              onClick={() => {
                const code = Math.max(0, ...items.map((o) => o.code)) + 1;
                onChange([...items, { code, label: `Item ${code}` }]);
              }}
            >
              + Item
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ---- Blocks -----------------------------------------------------------------------------------

export function BlocksEditor({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const blocks = def.blocks ?? [];
  const set = (i: number, patch: Partial<Def['blocks'][number]>) =>
    onChange({ ...def, blocks: blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  return (
    <section className="stack" aria-labelledby="blocks-h">
      <h2 id="blocks-h" style={{ marginTop: 12 }}>
        Randomized blocks
        <InfoTip k="section.blocks" />
      </h2>
      <p className="muted small">
        Pages that follow one another, shown in a random order for each respondent (the order stays the same if they come back). Show only
        some of them with &quot;Pages to show&quot;, for example 2 of 4 concepts.
      </p>
      {blocks.map((b, i) => (
        <div key={i} className="row flow-card" data-testid={`block-${b.id}`}>
          <label className="field">
            Block id
            <input className="mono" value={b.id} onChange={(e) => set(i, { id: e.target.value })} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Pages (comma separated)
            <input
              className="mono"
              value={b.pages.join(', ')}
              onChange={(e) =>
                set(i, {
                  pages: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="field">
            Pages to show
            <input
              type="number"
              min={1}
              style={{ width: 90 }}
              value={b.pick ?? ''}
              placeholder="All"
              onChange={(e) => set(i, { pick: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={b.randomize} onChange={(e) => set(i, { randomize: e.target.checked })} /> Random order
          </label>
          {b.pick !== undefined ? (
            <label className="field">
              Choose pages
              <select value={b.balance} onChange={(e) => set(i, { balance: e.target.value as 'random' | 'least_fill' })}>
                <option value="random">At random</option>
                <option value="least_fill">Least shown so far (balanced)</option>
              </select>
            </label>
          ) : null}
          <button className="link danger" onClick={() => onChange({ ...def, blocks: blocks.filter((_, j) => j !== i) })}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button
          onClick={() =>
            onChange({
              ...def,
              blocks: [
                ...blocks,
                { id: `B${blocks.length + 1}`, pages: def.pages.slice(-2).map((p) => p.id), randomize: true, balance: 'random' },
              ],
            })
          }
          disabled={def.pages.length < 2}
        >
          + Block
        </button>
      </div>
    </section>
  );
}

// ---- Calculated variables ------------------------------------------------------------------------

export function VariablesEditor({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const vars = def.variables ?? [];
  const set = (i: number, patch: Partial<Def['variables'][number]>) =>
    onChange({ ...def, variables: vars.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  return (
    <section className="stack" aria-labelledby="vars-h">
      <h2 id="vars-h" style={{ marginTop: 12 }}>
        Calculated variables
        <InfoTip k="section.variables" />
      </h2>
      <p className="muted small">
        Values worked out from answers, usable in conditions, quotas and piping ({'{{NAME}}'}) and exported as their own column.{' '}
        {LOGIC_HELP}
      </p>
      <table className="data list-editor">
        <thead>
          <tr>
            <th>Name</th>
            <th>Formula</th>
            <th>Label</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {vars.map((v, i) => (
            <tr key={i}>
              <td>
                <input className="mono" aria-label="Variable name" value={v.id} onChange={(e) => set(i, { id: e.target.value })} />
              </td>
              <td>
                <input className="mono" aria-label="Formula" value={v.expr} onChange={(e) => set(i, { expr: e.target.value })} />
              </td>
              <td>
                <input aria-label="Variable label" value={v.label ?? ''} onChange={(e) => set(i, { label: e.target.value || undefined })} />
              </td>
              <td>
                <button className="link danger" onClick={() => onChange({ ...def, variables: vars.filter((_, j) => j !== i) })}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div>
        <button onClick={() => onChange({ ...def, variables: [...vars, { id: `V${vars.length + 1}`, expr: '1' }] })}>+ Variable</button>
      </div>
    </section>
  );
}

// ---- Recodes (blueprint phase 4) ---------------------------------------------------------------------

type RecodeDef = Def['recodes'][number];
type RecodeGroup = RecodeDef['groups'][number];

/** One group per line: "code | label | values" where values are "1,2,3" or a range "18..34", "55..", "..17". */
export function groupsToText(groups: RecodeGroup[]) {
  return groups
    .map((g) => {
      const what = g.values?.length ? g.values.join(',') : `${g.min ?? ''}..${g.max ?? ''}`;
      return `${g.code} | ${g.label} | ${what}`;
    })
    .join('\n');
}
export function textToGroups(text: string): { groups: RecodeGroup[]; error?: string } {
  const groups: RecodeGroup[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const [c, label, what] = line.split('|').map((x) => x.trim());
    const code = Number(c);
    if (!Number.isInteger(code) || !label || !what) return { groups, error: `Line ${i + 1}: write code | label | values or range.` };
    const range = /^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/.exec(what);
    if (range && (range[1] !== undefined || range[2] !== undefined))
      groups.push({
        code,
        label,
        ...(range[1] !== undefined ? { min: Number(range[1]) } : {}),
        ...(range[2] !== undefined ? { max: Number(range[2]) } : {}),
      });
    else
      groups.push({
        code,
        label,
        values: what
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => (/^-?\d+(\.\d+)?$/.test(x) ? Number(x) : x)),
      });
  }
  return groups.length ? { groups } : { groups, error: 'Add at least one group.' };
}

function RecodeGroups({ value, onChange }: { value: RecodeGroup[]; onChange: (g: RecodeGroup[]) => void }) {
  const [text, setText] = useState(() => groupsToText(value));
  const [error, setError] = useState<string>();
  return (
    <>
      <textarea
        className="mono"
        rows={Math.max(3, value.length + 1)}
        aria-label="Groups"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const r = textToGroups(e.target.value);
          setError(r.error);
          if (!r.error) onChange(r.groups);
        }}
      />
      {error && <p className="error small">{error}</p>}
    </>
  );
}

export function RecodesEditor({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const recodes = def.recodes ?? [];
  const set = (i: number, patch: Partial<RecodeDef>) =>
    onChange({ ...def, recodes: recodes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const sources = [
    ...def.pages.flatMap((p) =>
      p.questions.flatMap((q) =>
        q.type === 'grid'
          ? q.rows.map((r) => `${q.id}_${r.id}`)
          : q.type === 'ranking' || q.type === 'sum' || q.type === 'cardsort'
            ? q.options.map((o) => `${q.id}_${o.code}`)
            : q.type === 'single' || q.type === 'multi' || q.type === 'scale' || q.type === 'numeric' || q.type === 'hotspot'
              ? [q.id]
              : [],
      ),
    ),
    ...(def.variables ?? []).map((v) => v.id),
    'vendor',
    'mode',
    'language',
    'device',
    ...recodes.map((r) => r.id),
  ];
  return (
    <section className="stack" aria-labelledby="recodes-h">
      <h2 id="recodes-h" style={{ marginTop: 12 }}>
        Recodes
        <InfoTip k="section.recodes" />
      </h2>
      <p className="muted small">
        New analysis variables that group another variable&apos;s answers, such as age bands or top-2 box. Answers are not changed; recodes
        appear in Analysis (with where they come from) and in exports. One group per line: <code>code | label | values</code>, where values
        are codes like <code>4,5</code> or a range like <code>18..34</code>, <code>55..</code>.
      </p>
      <datalist id="recode-sources">
        {sources.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {recodes.map((r, i) => (
        <fieldset key={i} className="stack" data-testid={`recode-${i}`}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label>
              Recode
              <input className="mono" aria-label="Recode id" value={r.id} onChange={(e) => set(i, { id: e.target.value })} />
            </label>
            <label>
              From
              <input
                className="mono"
                list="recode-sources"
                aria-label="Recode source"
                value={r.source}
                onChange={(e) => set(i, { source: e.target.value })}
              />
            </label>
            <label>
              Label
              <input aria-label="Recode label" value={r.label ?? ''} onChange={(e) => set(i, { label: e.target.value || undefined })} />
            </label>
            <button className="link danger" onClick={() => onChange({ ...def, recodes: recodes.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
          <RecodeGroups value={r.groups} onChange={(groups) => set(i, { groups })} />
          <label className="row small" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={!!r.otherwise}
              onChange={(e) => set(i, { otherwise: e.target.checked ? { code: 99, label: 'Other' } : undefined })}
            />
            Put other answers in group 99 &quot;Other&quot;
          </label>
        </fieldset>
      ))}
      <div>
        <button
          onClick={() =>
            onChange({
              ...def,
              recodes: [
                ...recodes,
                { id: `R${recodes.length + 1}`, source: sources[0] ?? '', groups: [{ code: 1, label: 'Group 1', values: [1] }] },
              ],
            })
          }
        >
          + Recode
        </button>
      </div>
    </section>
  );
}

// ---- Cleaning rules (blueprint phase 5) ------------------------------------------------------------

type CleaningDef = Def['cleaning'][number];

export function CleaningEditor({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const rules = def.cleaning ?? [];
  const set = (i: number, patch: Partial<CleaningDef>) =>
    onChange({ ...def, cleaning: rules.map((r, j) => (j === i ? ({ ...r, ...patch } as CleaningDef) : r)) });
  const targets = def.pages.flatMap((p) =>
    p.questions.filter((q) => q.type === 'single' || q.type === 'numeric' || q.type === 'scale' || q.type === 'open'),
  );
  return (
    <section className="stack" aria-labelledby="cleaning-h">
      <h2 id="cleaning-h" style={{ marginTop: 12 }}>
        Cleaning rules
        <InfoTip k="section.cleaning" />
      </h2>
      <p className="muted small">
        Edit or fill answers when data is analysed or exported, in order. Stored answers are never changed; Analysis marks cleaned questions
        and exports list the rules applied to each row. <em>Set</em> and <em>clear</em> apply when the condition holds (every record when
        empty); <em>impute</em> fills blanks with the mean, median or most common answer.
      </p>
      {rules.map((r, i) => (
        <fieldset key={i} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} data-testid={`cleaning-${i}`}>
          <label>
            Rule
            <input
              className="mono"
              aria-label="Cleaning rule id"
              value={r.id}
              onChange={(e) => set(i, { id: e.target.value })}
              style={{ width: 90 }}
            />
          </label>
          <label>
            Question
            <select aria-label="Cleaning target" value={r.target} onChange={(e) => set(i, { target: e.target.value })}>
              {targets.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select
              aria-label="Cleaning action"
              value={r.action}
              onChange={(e) => {
                const action = e.target.value as CleaningDef['action'];
                set(i, {
                  action,
                  value: action === 'set' ? (r.value ?? 0) : undefined,
                  method: action === 'impute' ? (r.method ?? 'mode') : undefined,
                });
              }}
            >
              <option value="clear">Clear</option>
              <option value="set">Set to</option>
              <option value="impute">Impute blanks</option>
            </select>
          </label>
          {r.action === 'set' ? (
            <label>
              Value
              <input
                aria-label="Cleaning value"
                value={r.value === undefined ? '' : String(r.value)}
                onChange={(e) => set(i, { value: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })}
                style={{ width: 90 }}
              />
            </label>
          ) : null}
          {r.action === 'impute' ? (
            <label>
              With
              <select
                aria-label="Impute method"
                value={r.method}
                onChange={(e) => set(i, { method: e.target.value as CleaningDef['method'] })}
              >
                <option value="mode">most common answer</option>
                <option value="median">median</option>
                <option value="mean">mean</option>
              </select>
            </label>
          ) : null}
          <label style={{ flex: 1, minWidth: 200 }}>
            When (optional)
            <input
              className="mono"
              aria-label="Cleaning condition"
              placeholder="e.g. AGE > 99"
              value={r.when ?? ''}
              onChange={(e) => set(i, { when: e.target.value || undefined })}
            />
          </label>
          <button className="link danger" onClick={() => onChange({ ...def, cleaning: rules.filter((_, j) => j !== i) })}>
            Remove
          </button>
        </fieldset>
      ))}
      <div>
        <button
          disabled={!targets.length}
          onClick={() =>
            onChange({
              ...def,
              cleaning: [...rules, { id: `C${rules.length + 1}`, target: targets[0]!.id, action: 'clear' } as CleaningDef],
            })
          }
        >
          + Cleaning rule
        </button>
      </div>
    </section>
  );
}

// ---- URL variables ------------------------------------------------------------------------------

export function UrlVariablesEditor({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const vars = def.urlVariables ?? [];
  const set = (i: number, patch: Partial<Def['urlVariables'][number]>) =>
    onChange({ ...def, urlVariables: vars.map((v, j) => (j === i ? { ...v, ...patch } : v)) });
  return (
    <section className="stack" aria-labelledby="urlvars-h">
      <h2 id="urlvars-h" style={{ marginTop: 12 }}>
        URL variables
        <InfoTip k="section.urlVariables" />
      </h2>
      <p className="muted small">
        Values passed on the survey link, such as <span className="mono">&amp;seg=B2B</span> from a panel or CRM. They are saved with the
        response, exported as a column, and usable in conditions, quotas and piping like an answer. Respondents never see them as questions.
      </p>
      {vars.length ? (
        <table className="data list-editor">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Link parameter</th>
              <th>Description</th>
              <th>Number</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {vars.map((v, i) => (
              <tr key={i}>
                <td>
                  <input className="mono" aria-label="URL variable" value={v.id} onChange={(e) => set(i, { id: e.target.value })} />
                </td>
                <td>
                  <input className="mono" aria-label="Link parameter" value={v.param} onChange={(e) => set(i, { param: e.target.value })} />
                </td>
                <td>
                  <input
                    aria-label="URL variable description"
                    value={v.label ?? ''}
                    onChange={(e) => set(i, { label: e.target.value || undefined })}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${v.id} is a number`}
                    checked={v.numeric}
                    onChange={(e) => set(i, { numeric: e.target.checked })}
                  />
                </td>
                <td>
                  <button className="link danger" onClick={() => onChange({ ...def, urlVariables: vars.filter((_, j) => j !== i) })}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div>
        <button
          onClick={() =>
            onChange({ ...def, urlVariables: [...vars, { id: `URL${vars.length + 1}`, param: `p${vars.length + 1}`, numeric: false }] })
          }
        >
          + URL variable
        </button>
      </div>
    </section>
  );
}

// ---- Interlocking quota table ---------------------------------------------------------------------

/** Builds one quota per combination of two or three questions (interlocking / nested quotas). */
export function QuotaTableBuilder({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const dims = quotaDimensions(def);
  const [picked, setPicked] = useState<string[]>([]);
  const [total, setTotal] = useState(300);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const chosen = picked.map((id) => dims.find((d) => d.id === id)).filter((d): d is QuotaDimension => !!d);
  const cells = chosen.length ? quotaTableCells(chosen, total, targets) : [];
  const add = () => {
    onChange({ ...def, quotas: [...def.quotas, ...quotasFromCells(def, cells)] });
    setPicked([]);
    setTargets({});
  };
  return (
    <details className="panel flow-card" data-testid="quota-table">
      <summary>
        <strong>Build an interlocking quota table</strong>{' '}
        <span className="muted small">(one quota per combination, e.g. region × age)</span>
      </summary>
      <div className="stack" style={{ marginTop: 10 }}>
        <div className="row">
          {[0, 1, 2].map((i) => (
            <label key={i} className="field">
              {i === 0 ? 'First question' : i === 1 ? 'Second question' : 'Third (optional)'}
              <select
                value={picked[i] ?? ''}
                onChange={(e) => {
                  const next = [...picked];
                  next[i] = e.target.value;
                  setPicked(next.filter(Boolean));
                  setTargets({});
                }}
                disabled={i > picked.length}
              >
                <option value="">—</option>
                {dims
                  .filter((d) => !picked.includes(d.id) || picked[i] === d.id)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id} ({d.options.length})
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label className="field">
            Total completes
            <input type="number" min={0} value={total} style={{ width: 110 }} onChange={(e) => setTotal(Number(e.target.value) || 0)} />
          </label>
        </div>
        {chosen.length >= 2 ? (
          <>
            <p className="muted small">
              {cells.length} cells. Targets start as an even split of the total (adding up to it exactly); adjust any cell.
            </p>
            <table className="data list-editor">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>Condition</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(0, 200).map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td className="mono small">{c.condition}</td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        aria-label={`Target for ${c.label}`}
                        value={c.target}
                        style={{ width: 90 }}
                        onChange={(e) => setTargets({ ...targets, [c.key]: Number(e.target.value) || 0 })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <button className="primary" onClick={add} disabled={cells.length > 200}>
                Add {cells.length} quotas
              </button>
            </div>
          </>
        ) : (
          <p className="muted small">Choose at least two single choice or rating questions.</p>
        )}
      </div>
    </details>
  );
}

// ---- Question-level editors ---------------------------------------------------------------------

/** "Take the options from an earlier question" for single, multiple choice and ranking. */
export function DynamicListEditor({
  q,
  def,
  onChange,
}: {
  q: Extract<Question, { type: 'single' | 'multi' | 'ranking' }>;
  def: Def;
  onChange: (q: Question) => void;
}) {
  const sources = def.pages
    .flatMap((p) => p.questions)
    .filter(
      (x): x is Extract<Question, { type: 'single' | 'multi' | 'ranking' }> =>
        x.id !== q.id && (x.type === 'single' || x.type === 'multi' || x.type === 'ranking'),
    );
  const from = q.optionsFrom;
  return (
    <div className="row">
      <label className="field">
        Dynamic list: offer only the options
        <select
          aria-label="Dynamic list"
          value={from ? `${from.include}:${from.question}` : ''}
          onChange={(e) => {
            if (!e.target.value) return onChange({ ...q, optionsFrom: undefined });
            const [include, question] = e.target.value.split(':') as ['selected' | 'not_selected', string];
            const src = sources.find((s) => s.id === question);
            // Copy the source's options when this list has none of its codes, so codes line up.
            const shares = src && q.options.some((o) => src.options.some((so) => so.code === o.code));
            onChange({
              ...q,
              optionsFrom: { question, include },
              ...(src && !shares ? { options: src.options.map((o) => ({ ...o })) } : {}),
            });
          }}
        >
          <option value="">— all options (off)</option>
          {sources.map((s) => (
            <option key={`s${s.id}`} value={`selected:${s.id}`}>
              chosen at {s.id}
            </option>
          ))}
          {sources.map((s) => (
            <option key={`n${s.id}`} value={`not_selected:${s.id}`}>
              not chosen at {s.id}
            </option>
          ))}
        </select>
      </label>
      {from ? (
        <p className="muted small" style={{ maxWidth: 420 }}>
          Options use the same codes as {from.question}. Options whose code {from.question} does not have (such as &quot;None of
          these&quot;) are always offered. When nothing is left, the question is skipped.
        </p>
      ) : null}
    </div>
  );
}

export function CardSortForm({
  q,
  onChange,
  OptionsEditor,
}: {
  q: Extract<Question, { type: 'cardsort' }>;
  onChange: (q: Question) => void;
  OptionsEditor: (p: { options: Option[]; onChange: (o: Option[]) => void; anchors?: boolean }) => React.ReactElement;
}) {
  return (
    <>
      <h3>Cards</h3>
      <p className="muted small">Stored as card code → group code. In logic, {q.id}.2 is the group card 2 was put in.</p>
      <OptionsEditor options={q.options} anchors={false} onChange={(options) => onChange({ ...q, options })} />
      <h3>Groups</h3>
      <OptionsEditor options={q.groups} anchors={false} onChange={(groups) => onChange({ ...q, groups })} />
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={q.randomize} onChange={(e) => onChange({ ...q, randomize: e.target.checked })} /> Shuffle the
          cards
        </label>
        <label className="check">
          <input type="checkbox" checked={q.allowUnsorted} onChange={(e) => onChange({ ...q, allowUnsorted: e.target.checked })} /> Cards
          may be left unsorted
        </label>
      </div>
    </>
  );
}

/**
 * A picture with rectangular areas drawn on it (hot-spot areas, eye-tracking areas of interest):
 * choose the picture, then drag on it to draw an area; each area gets a code and a label. Areas are
 * stored in percent so they scale with the picture.
 */
function PictureAreas({
  id,
  image,
  imageAlt,
  areas,
  minAreas,
  noun,
  onImage,
  onAlt,
  onAreas,
}: {
  id: string;
  image?: string;
  imageAlt: string;
  areas: HotspotRegion[];
  minAreas: number;
  noun: 'area' | 'area of interest';
  onImage: (image: string | undefined) => void;
  onAlt: (alt: string) => void;
  onAreas: (areas: HotspotRegion[]) => void;
}) {
  const hasLibrary = useHasMediaLibrary();
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const pct = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    };
  };
  const setRegion = (i: number, patch: Partial<HotspotRegion>) => onAreas(areas.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const round = (n: number) => Math.round(n * 10) / 10;
  return (
    <>
      <h3>Picture</h3>
      {hasLibrary ? (
        <OptionImagePicker image={image} label={id} onChange={onImage} />
      ) : (
        <p className="muted small">Open the survey to upload a picture.</p>
      )}
      <label className="field">
        Describe the picture (for screen readers)
        <input value={imageAlt} onChange={(e) => onAlt(e.target.value)} />
      </label>
      {image ? (
        <>
          <p className="muted small">Drag on the picture to add {noun === 'area' ? 'an area' : `an ${noun}`}.</p>
          <div
            ref={box}
            className="hotspot-canvas"
            onPointerDown={(e) => {
              const p = pct(e);
              (e.target as Element).setPointerCapture?.(e.pointerId);
              setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onPointerMove={(e) => draft && setDraft({ ...draft, x1: pct(e).x, y1: pct(e).y })}
            onPointerUp={() => {
              if (!draft) return;
              const x = Math.min(draft.x0, draft.x1);
              const y = Math.min(draft.y0, draft.y1);
              const w = Math.abs(draft.x1 - draft.x0);
              const h = Math.abs(draft.y1 - draft.y0);
              setDraft(null);
              if (w < 2 || h < 2) return;
              const code = Math.max(0, ...areas.map((r) => r.code)) + 1;
              onAreas([...areas, { code, label: `Area ${code}`, x: round(x), y: round(y), w: round(w), h: round(h) }]);
            }}
          >
            <img src={mediaSrc(image)} alt="" draggable={false} />
            {areas.map((r) => (
              <span
                key={r.code}
                className="hotspot-region"
                style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
              >
                {r.label}
              </span>
            ))}
            {draft ? (
              <span
                className="hotspot-region drawing"
                style={{
                  left: `${Math.min(draft.x0, draft.x1)}%`,
                  top: `${Math.min(draft.y0, draft.y1)}%`,
                  width: `${Math.abs(draft.x1 - draft.x0)}%`,
                  height: `${Math.abs(draft.y1 - draft.y0)}%`,
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
      <h3>{noun === 'area' ? 'Areas' : 'Areas of interest'}</h3>
      <table className="data list-editor">
        <thead>
          <tr>
            <th>Code</th>
            <th>Label</th>
            <th>Left %</th>
            <th>Top %</th>
            <th>Width %</th>
            <th>Height %</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {areas.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  type="number"
                  aria-label="Area code"
                  value={r.code}
                  style={{ width: 70 }}
                  onChange={(e) => setRegion(i, { code: Number(e.target.value) })}
                />
              </td>
              <td>
                <input aria-label="Area label" value={r.label} onChange={(e) => setRegion(i, { label: e.target.value })} />
              </td>
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <td key={k}>
                  <input
                    type="number"
                    aria-label={`Area ${k}`}
                    value={r[k]}
                    style={{ width: 70 }}
                    onChange={(e) => setRegion(i, { [k]: Number(e.target.value) })}
                  />
                </td>
              ))}
              <td>
                <button
                  className="link danger"
                  disabled={areas.length <= minAreas}
                  onClick={() => onAreas(areas.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Hot-spot editor: the picture and its clickable areas, plus how many a respondent may pick. */
export function HotspotForm({ q, onChange }: { q: Extract<Question, { type: 'hotspot' }>; onChange: (q: Question) => void }) {
  return (
    <>
      <PictureAreas
        id={q.id}
        image={q.image}
        imageAlt={q.imageAlt}
        areas={q.regions}
        minAreas={1}
        noun="area"
        onImage={(image) => onChange({ ...q, image })}
        onAlt={(imageAlt) => onChange({ ...q, imageAlt })}
        onAreas={(regions) => onChange({ ...q, regions })}
      />

      <div className="row">
        <label className="field">
          Minimum areas
          <input
            type="number"
            min={0}
            style={{ width: 90 }}
            value={q.minSelected ?? ''}
            onChange={(e) => onChange({ ...q, minSelected: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
        <label className="field">
          Maximum areas
          <input
            type="number"
            min={1}
            style={{ width: 90 }}
            value={q.maxSelected ?? ''}
            onChange={(e) => onChange({ ...q, maxSelected: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
        </label>
      </div>
    </>
  );
}

/**
 * Webcam eye tracking (experimental): the picture, its areas of interest, how long it is shown, the
 * calibration error above which a recording is left out of results, and the consent text.
 */
export function EyeTrackForm({ q, onChange }: { q: Extract<Question, { type: 'eyetrack' }>; onChange: (q: Question) => void }) {
  return (
    <>
      <p className="callout small" data-testid="eyetrack-experimental">
        Experimental. The gaze is estimated in the respondent&apos;s browser from the webcam after a short calibration. It is approximate
        (several percent of the screen at best) and has not been validated on real webcams, so read heatmaps as a rough guide. The camera
        picture never leaves the device; only the estimated points on the picture are saved. Respondents can always skip, and the task runs
        only in the online survey (not in the offline app or the preview).
      </p>
      <PictureAreas
        id={q.id}
        image={q.image}
        imageAlt={q.imageAlt}
        areas={q.aois}
        minAreas={0}
        noun="area of interest"
        onImage={(image) => onChange({ ...q, image })}
        onAlt={(imageAlt) => onChange({ ...q, imageAlt })}
        onAreas={(aois) => onChange({ ...q, aois })}
      />
      <div className="row">
        <label className="field">
          Show the picture for (seconds)
          <input
            type="number"
            min={3}
            max={30}
            style={{ width: 90 }}
            value={q.durationSec}
            onChange={(e) => onChange({ ...q, durationSec: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          Leave out recordings less accurate than (% of screen)
          <input
            type="number"
            min={2}
            max={40}
            style={{ width: 90 }}
            value={q.maxErrorPct}
            onChange={(e) => onChange({ ...q, maxErrorPct: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="field">
        Camera consent (shown before the camera turns on)
        <textarea rows={3} value={q.consentText} onChange={(e) => onChange({ ...q, consentText: e.target.value })} />
      </label>
    </>
  );
}
