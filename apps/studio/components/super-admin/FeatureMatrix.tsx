'use client';
/**
 * The feature grid used across the super admin console: one row per feature, one column per
 * surface (web CRM and mobile app). Each cell is a checkbox; cells can show where their value comes
 * from (the plan, or a change for this organization or member).
 */
import { Fragment } from 'react';
import { Monitor, Smartphone } from 'lucide-react';

export interface FeatureDef {
  key: string;
  label: string;
  group: string;
  description: string;
  surfaces: Array<'web' | 'mobile'>;
}

export type Surface = 'web' | 'mobile';
export const SURFACES: Surface[] = ['web', 'mobile'];

export interface Cell {
  checked: boolean;
  /** Small note under the box, e.g. "plan" or "changed". */
  note?: string;
  /** Highlight as a change from the default. */
  changed?: boolean;
  disabled?: boolean;
}

export function FeatureMatrix({
  features,
  cell,
  onToggle,
  testId,
  readOnly,
}: {
  features: FeatureDef[];
  cell: (key: string, surface: Surface) => Cell;
  onToggle?: (key: string, surface: Surface, on: boolean) => void;
  testId?: string;
  readOnly?: boolean;
}) {
  const groups = [...new Set(features.map((f) => f.group))];
  const setAll = (surface: Surface, on: boolean) => {
    for (const f of features) if (f.surfaces.includes(surface) && cell(f.key, surface).checked !== on) onToggle?.(f.key, surface, on);
  };
  return (
    <div className="scroll-x">
      <table className="data small sa-matrix" data-testid={testId}>
        <thead>
          <tr>
            <th>Feature</th>
            <th className="sa-matrix-col">
              <span className="sa-surface">
                <Monitor size={14} aria-hidden="true" /> Web CRM
              </span>
              {!readOnly && onToggle ? (
                <span className="sa-all">
                  <button type="button" className="link small" onClick={() => setAll('web', true)}>
                    all
                  </button>
                  <button type="button" className="link small" onClick={() => setAll('web', false)}>
                    none
                  </button>
                </span>
              ) : null}
            </th>
            <th className="sa-matrix-col">
              <span className="sa-surface">
                <Smartphone size={14} aria-hidden="true" /> Mobile app
              </span>
              {!readOnly && onToggle ? (
                <span className="sa-all">
                  <button type="button" className="link small" onClick={() => setAll('mobile', true)}>
                    all
                  </button>
                  <button type="button" className="link small" onClick={() => setAll('mobile', false)}>
                    none
                  </button>
                </span>
              ) : null}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr className="sa-group">
                <th colSpan={3}>{g}</th>
              </tr>
              {features
                .filter((f) => f.group === g)
                .map((f) => (
                  <tr key={f.key} data-testid={`feature-row-${f.key}`}>
                    <td>
                      <strong>{f.label}</strong>
                      <div className="muted">{f.description}</div>
                    </td>
                    {SURFACES.map((s) => {
                      if (!f.surfaces.includes(s))
                        return (
                          <td key={s} className="sa-matrix-col muted">
                            web only
                          </td>
                        );
                      const c = cell(f.key, s);
                      return (
                        <td key={s} className={`sa-matrix-col${c.changed ? ' sa-changed' : ''}`}>
                          <input
                            type="checkbox"
                            aria-label={`${f.label} on ${s === 'web' ? 'web CRM' : 'mobile app'}`}
                            data-testid={`feature-${f.key}-${s}`}
                            checked={c.checked}
                            disabled={readOnly || c.disabled || !onToggle}
                            onChange={(e) => onToggle?.(f.key, s, e.target.checked)}
                          />
                          {c.note ? <div className="sa-note">{c.note}</div> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
