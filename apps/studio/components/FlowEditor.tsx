'use client';
/**
 * Survey flow editors (blueprint phase 1): loops, randomized blocks, calculated variables, the
 * interlocking quota table builder, dynamic answer lists, card sort and image hot-spot questions.
 * Like the rest of the Visual Builder they edit the canonical definition directly, so the Code
 * workspace, the AI and every other view see the same thing.
 */
import { useRef, useState } from 'react';
import type { HotspotRegion, Option, Question, Quota, SurveyDefinition } from '@zapx/survey-schema';
import { OptionImagePicker, mediaSrc, useHasMediaLibrary } from './MediaLibrary';

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
              blocks: [...blocks, { id: `B${blocks.length + 1}`, pages: def.pages.slice(-2).map((p) => p.id), randomize: true }],
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

// ---- Interlocking quota table ---------------------------------------------------------------------

type Dim = { id: string; options: Array<{ code: number; label: string }> };

function dimsOf(def: Def): Dim[] {
  return def.pages.flatMap((p) =>
    p.questions.flatMap((q): Dim[] => {
      if (q.type === 'single') return [{ id: q.id, options: q.options }];
      if (q.type === 'scale') {
        const opts = [];
        for (let c = q.min; c <= q.max; c++) opts.push({ code: c, label: String(c) });
        return [{ id: q.id, options: opts }];
      }
      return [];
    }),
  );
}

/** Builds one quota per combination of two or three questions (interlocking / nested quotas). */
export function QuotaTableBuilder({ def, onChange }: { def: Def; onChange: (d: Def) => void }) {
  const dims = dimsOf(def);
  const [picked, setPicked] = useState<string[]>([]);
  const [total, setTotal] = useState(300);
  const [targets, setTargets] = useState<Record<string, number>>({});
  const chosen = picked.map((id) => dims.find((d) => d.id === id)).filter((d): d is Dim => !!d);
  const cells: Array<Array<{ q: string; code: number; label: string }>> = chosen.reduce<
    Array<Array<{ q: string; code: number; label: string }>>
  >((acc, d) => acc.flatMap((combo) => d.options.map((o) => [...combo, { q: d.id, code: o.code, label: o.label }])), [[]]);
  const keyOf = (c: Array<{ q: string; code: number }>) => c.map((x) => `${x.q}${x.code < 0 ? 'm' + -x.code : x.code}`).join('_');
  const even = cells.length ? Math.floor(total / cells.length) : 0;
  const targetOf = (k: string) => targets[k] ?? even;
  const add = () => {
    const existing = new Set(def.quotas.map((q) => q.id.toLowerCase()));
    const fresh: Quota[] = cells
      .map((c) => ({
        id: `QT_${keyOf(c)}`.slice(0, 64),
        label: c.map((x) => x.label).join(' × '),
        condition: c.map((x) => `${x.q} == ${x.code}`).join(' and '),
        target: targetOf(keyOf(c)),
      }))
      .filter((q) => !existing.has(q.id.toLowerCase()));
    onChange({ ...def, quotas: [...def.quotas, ...fresh] });
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
            <p className="muted small">{cells.length} cells. Targets start as an even split of the total; adjust any cell.</p>
            <table className="data list-editor">
              <thead>
                <tr>
                  <th>Cell</th>
                  <th>Condition</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                {cells.slice(0, 200).map((c) => {
                  const k = keyOf(c);
                  return (
                    <tr key={k}>
                      <td>{c.map((x) => x.label).join(' × ')}</td>
                      <td className="mono small">{c.map((x) => `${x.q} == ${x.code}`).join(' and ')}</td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          aria-label={`Target for ${c.map((x) => x.label).join(' × ')}`}
                          value={targetOf(k)}
                          style={{ width: 90 }}
                          onChange={(e) => setTargets({ ...targets, [k]: Number(e.target.value) || 0 })}
                        />
                      </td>
                    </tr>
                  );
                })}
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
 * Hot-spot editor: choose the picture, then drag on it to draw an area; each area gets a code and a
 * label (its name for screen readers). Areas are stored in percent so they scale with the picture.
 */
export function HotspotForm({ q, onChange }: { q: Extract<Question, { type: 'hotspot' }>; onChange: (q: Question) => void }) {
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
  const setRegion = (i: number, patch: Partial<HotspotRegion>) =>
    onChange({ ...q, regions: q.regions.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const round = (n: number) => Math.round(n * 10) / 10;
  return (
    <>
      <h3>Picture</h3>
      {hasLibrary ? (
        <OptionImagePicker image={q.image} label={q.id} onChange={(image) => onChange({ ...q, image })} />
      ) : (
        <p className="muted small">Open the survey to upload a picture.</p>
      )}
      <label className="field">
        Describe the picture (for screen readers)
        <input value={q.imageAlt} onChange={(e) => onChange({ ...q, imageAlt: e.target.value })} />
      </label>
      {q.image ? (
        <>
          <p className="muted small">Drag on the picture to add an area.</p>
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
              const code = Math.max(0, ...q.regions.map((r) => r.code)) + 1;
              onChange({
                ...q,
                regions: [...q.regions, { code, label: `Area ${code}`, x: round(x), y: round(y), w: round(w), h: round(h) }],
              });
            }}
          >
            <img src={mediaSrc(q.image)} alt="" draggable={false} />
            {q.regions.map((r) => (
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
      <h3>Areas</h3>
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
          {q.regions.map((r, i) => (
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
                  disabled={q.regions.length <= 1}
                  onClick={() => onChange({ ...q, regions: q.regions.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
