'use client';
/**
 * Editors for redirect rules: a URL and a status word per outcome, and per-country overrides.
 * Used at every configuration level (vendor, project, organization).
 */
import { useState } from 'react';

export const STATUSES = [
  ['complete', 'Complete'],
  ['terminate', 'Terminate'],
  ['quota_full', 'Quota full'],
  ['quality_fail', 'Quality fail'],
  ['security_reject', 'Security reject'],
  ['duplicate', 'Duplicate'],
  ['partial', 'Partial (abandoned)'],
  ['technical_error', 'Technical error'],
] as const;
export type Status = (typeof STATUSES)[number][0];

export type StatusMap = Partial<Record<Status, string>>;
export interface Rules {
  urls: StatusMap;
  words: StatusMap;
}
export interface Layer extends Rules {
  countries: Record<string, Rules>;
}

export const emptyLayer = (): Layer => ({ urls: {}, words: {}, countries: {} });

const FALLBACK_HINT: Partial<Record<Status, string>> = {
  duplicate: 'uses Security reject URL if empty',
  quality_fail: 'uses Terminate URL if empty',
  partial: 'uses Terminate URL if empty',
  technical_error: 'uses Terminate URL if empty',
};

/** Drop empty strings so a cleared field means "not set at this level". */
export function cleanMap(m: StatusMap): StatusMap {
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v && v.trim() !== '')) as StatusMap;
}

export function cleanLayer(l: Layer): Layer {
  return {
    urls: cleanMap(l.urls),
    words: cleanMap(l.words),
    countries: Object.fromEntries(Object.entries(l.countries).map(([cc, r]) => [cc, { urls: cleanMap(r.urls), words: cleanMap(r.words) }])),
  };
}

export function StatusTable({
  rules,
  onChange,
  label,
  hideUrls,
  urlPlaceholder,
}: {
  rules: Rules;
  onChange: (r: Rules) => void;
  /** Prefix for accessible names, e.g. "DE" for a country override. */
  label?: string;
  hideUrls?: boolean;
  urlPlaceholder?: string;
}) {
  const p = label ? `${label} ` : '';
  return (
    <table className="data list-editor">
      <thead>
        <tr>
          <th>Status</th>
          {hideUrls ? null : <th>Redirect URL</th>}
          <th>Status word for [STATUS]</th>
        </tr>
      </thead>
      <tbody>
        {STATUSES.map(([s, name]) => (
          <tr key={s}>
            <td>{name}</td>
            {hideUrls ? null : (
              <td>
                <input
                  aria-label={`${p}${name} URL`}
                  style={{ width: '100%' }}
                  placeholder={FALLBACK_HINT[s] ?? urlPlaceholder ?? 'https://…'}
                  value={rules.urls[s] ?? ''}
                  onChange={(e) => onChange({ ...rules, urls: { ...rules.urls, [s]: e.target.value } })}
                />
              </td>
            )}
            <td>
              <input
                aria-label={`${p}${name} status word`}
                placeholder={s}
                value={rules.words[s] ?? ''}
                onChange={(e) => onChange({ ...rules, words: { ...rules.words, [s]: e.target.value } })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CountryOverrides({
  countries,
  onChange,
  scope,
}: {
  countries: Record<string, Rules>;
  onChange: (c: Record<string, Rules>) => void;
  scope: string;
}) {
  const [code, setCode] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const add = () => {
    const cc = code.trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(cc) || countries[cc]) return;
    onChange({ ...countries, [cc]: { urls: {}, words: {} } });
    setOpen(cc);
    setCode('');
  };
  return (
    <div className="stack" style={{ gap: 6 }} data-testid={`country-overrides-${scope}`}>
      <div className="row">
        <strong className="small">Country overrides</strong>
        <span className="muted small">Used when the link carries that country (cc=DE). They win over the rules above.</span>
      </div>
      {Object.keys(countries).length === 0 ? <p className="muted small">None.</p> : null}
      {Object.entries(countries).map(([cc, rules]) => (
        <div key={cc} className="panel" style={{ padding: 8 }}>
          <div className="row">
            <button className="link" onClick={() => setOpen(open === cc ? null : cc)} aria-expanded={open === cc}>
              <span className="mono">{cc}</span> · {Object.values(cleanMap(rules.urls)).length} URLs,{' '}
              {Object.values(cleanMap(rules.words)).length} words
            </button>
            <div style={{ flex: 1 }} />
            <button
              className="danger"
              onClick={() => {
                const { [cc]: _removed, ...rest } = countries;
                onChange(rest);
              }}
            >
              Remove {cc}
            </button>
          </div>
          {open === cc ? <StatusTable label={cc} rules={rules} onChange={(r) => onChange({ ...countries, [cc]: r })} /> : null}
        </div>
      ))}
      <div className="row">
        <input
          aria-label={`New country code (${scope})`}
          placeholder="DE"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ width: 70 }}
        />
        <button onClick={add} disabled={!/^[A-Za-z]{2,3}$/.test(code.trim())}>
          Add country
        </button>
      </div>
    </div>
  );
}

/** A complete level editor (URLs, words, countries) with its own save button. */
export function LayerEditor({ initial, onSave, scope }: { initial: Layer; onSave: (l: Layer) => Promise<void>; scope: string }) {
  const [layer, setLayer] = useState<Layer>(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack">
      <StatusTable rules={layer} onChange={(r) => setLayer({ ...layer, ...r })} />
      <CountryOverrides scope={scope} countries={layer.countries} onChange={(countries) => setLayer({ ...layer, countries })} />
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row">
        <button
          className="primary"
          disabled={state === 'saving'}
          onClick={async () => {
            setState('saving');
            setError(null);
            try {
              await onSave(cleanLayer(layer));
              setState('saved');
            } catch (e) {
              setError((e as Error).message);
              setState('idle');
            }
          }}
        >
          Save defaults
        </button>
        {state === 'saved' ? <span className="ok-text small">Saved</span> : null}
      </div>
    </div>
  );
}
