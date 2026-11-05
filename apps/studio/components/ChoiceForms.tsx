'use client';
/** Editors for MaxDiff and conjoint questions (blueprint phase 4). */
import { conjointDesign, maxDiffDesign } from '@zapx/logic-engine';
import type { ConjointAttribute, ConjointQuestion, MaxDiffQuestion, Option, Question } from '@zapx/survey-schema';

type OptionsEditorType = (p: { options: Option[]; onChange: (o: Option[]) => void; anchors?: boolean }) => React.ReactNode;

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      />
    </label>
  );
}

export function MaxDiffForm({
  q,
  onChange,
  OptionsEditor,
}: {
  q: MaxDiffQuestion;
  onChange: (q: Question) => void;
  OptionsEditor: OptionsEditorType;
}) {
  const design = q.options.length >= 4 ? maxDiffDesign(q) : [];
  const shown = design[0] ? design[0].flat().length / q.options.length : 0;
  return (
    <>
      <h3>Items</h3>
      <p className="muted small">
        Respondents pick the best and the worst item in each set. Sets come from a balanced design (each item shown about equally often), in
        several versions spread across respondents. Results: counting scores in Analysis. Stored as {q.id} = {'{v, b1, w1, …}'}.
      </p>
      <OptionsEditor options={q.options} anchors={false} onChange={(options) => onChange({ ...q, options })} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <NumField label="Items per set" value={q.itemsPerSet} min={3} max={6} onChange={(itemsPerSet) => onChange({ ...q, itemsPerSet })} />
        <NumField label="Sets per respondent" value={q.sets} min={2} max={30} onChange={(sets) => onChange({ ...q, sets })} />
        <NumField label="Design versions" value={q.versions} min={1} max={50} onChange={(versions) => onChange({ ...q, versions })} />
        <label className="field">
          Best column
          <input value={q.bestLabel} onChange={(e) => onChange({ ...q, bestLabel: e.target.value })} />
        </label>
        <label className="field">
          Worst column
          <input value={q.worstLabel} onChange={(e) => onChange({ ...q, worstLabel: e.target.value })} />
        </label>
      </div>
      {shown ? (
        <p className={`small ${shown < 3 ? '' : 'muted'}`} data-testid="maxdiff-balance">
          Each item is shown about {shown.toFixed(1)} times per respondent{shown < 3 ? ': at least 3 is recommended, add sets.' : '.'}
        </p>
      ) : null}
    </>
  );
}

export function ConjointForm({ q, onChange }: { q: ConjointQuestion; onChange: (q: Question) => void }) {
  const setAttr = (i: number, a: ConjointAttribute) => onChange({ ...q, attributes: q.attributes.map((x, j) => (j === i ? a : x)) });
  const combos = q.attributes.reduce((n, a) => n * a.levels.length, 1);
  let balanced = true;
  try {
    const d = conjointDesign(q);
    balanced = q.attributes.every((a, ai) => {
      const counts = a.levels.map((l) => d.flat(2).filter((c) => c[ai] === l.code).length);
      return Math.max(...counts) - Math.min(...counts) <= q.versions;
    });
  } catch {
    balanced = false;
  }
  return (
    <>
      <h3>Attributes and levels</h3>
      <p className="muted small">
        In each task respondents choose one product concept{q.noneOption ? ' or none' : ''}. Concepts come from a level-balanced design with
        little overlap. Results: part-worths and importances from an aggregate logit model in Analysis.
      </p>
      {q.attributes.map((a, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }} data-testid="conjoint-attribute">
          <label className="field">
            Attribute id
            <input className="mono" value={a.id} onChange={(e) => setAttr(i, { ...a, id: e.target.value })} />
          </label>
          <label className="field">
            Attribute label
            <input value={a.label} onChange={(e) => setAttr(i, { ...a, label: e.target.value })} />
          </label>
          <label className="field" style={{ minWidth: 240 }}>
            Levels (one per line)
            <textarea
              rows={Math.max(2, a.levels.length)}
              defaultValue={a.levels.map((l) => l.label).join('\n')}
              onBlur={(e) => {
                const labels = e.target.value
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 9);
                setAttr(i, { ...a, levels: labels.map((label, k) => ({ code: k + 1, label })) });
              }}
            />
          </label>
          <button
            type="button"
            className="link danger"
            disabled={q.attributes.length <= 2}
            onClick={() => onChange({ ...q, attributes: q.attributes.filter((_, j) => j !== i) })}
          >
            Remove
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="secondary"
          disabled={q.attributes.length >= 8}
          onClick={() =>
            onChange({
              ...q,
              attributes: [
                ...q.attributes,
                {
                  id: `attr${q.attributes.length + 1}`,
                  label: `Attribute ${q.attributes.length + 1}`,
                  levels: [
                    { code: 1, label: 'Level 1' },
                    { code: 2, label: 'Level 2' },
                  ],
                },
              ],
            })
          }
        >
          + Add attribute
        </button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <NumField label="Tasks per respondent" value={q.tasks} min={2} max={20} onChange={(tasks) => onChange({ ...q, tasks })} />
        <NumField
          label="Concepts per task"
          value={q.conceptsPerTask}
          min={2}
          max={4}
          onChange={(conceptsPerTask) => onChange({ ...q, conceptsPerTask })}
        />
        <NumField label="Design versions" value={q.versions} min={1} max={50} onChange={(versions) => onChange({ ...q, versions })} />
        <label className="check">
          <input type="checkbox" checked={q.noneOption} onChange={(e) => onChange({ ...q, noneOption: e.target.checked })} />
          Offer &quot;none&quot;
        </label>
      </div>
      <p className="muted small" data-testid="conjoint-balance">
        {combos} possible concepts.{' '}
        {balanced ? 'Levels are balanced across the design.' : 'Levels are not well balanced: add tasks or versions.'}
      </p>
    </>
  );
}
