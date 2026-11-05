'use client';
/**
 * Vendor (sample source) settings: how respondents are redirected at the end, which callbacks
 * are sent, and the delivery and redirect logs. Two integration types:
 *   Direct  – ZAPX resolves redirects and sends signed callbacks itself.
 *   PROJEXA – ZAPX sits behind PROJEXA and follows PROJEXA's documented survey-platform contract.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { CountryOverrides, STATUSES, StatusTable, cleanLayer, type Rules, type Status, type StatusMap } from './RedirectRules';

export interface Vendor {
  id: string;
  name: string;
  code: string;
  integration: 'DIRECT' | 'PROJEXA';
  redirectMode: 'STATIC' | 'DYNAMIC' | 'HYBRID';
  staticUrls: StatusMap;
  statusWords: StatusMap;
  countryRedirects: Record<string, Rules>;
  dynamicAllowedHosts: string[];
  dynamicParam: string;
  requireSignedEntry: boolean;
  signRedirects: boolean;
  callbackUrl: string | null;
  callbackStatuses: Status[];
  callbackMaxAttempts: number;
  partnerBaseUrl: string | null;
  partnerSecretSet: boolean;
  partnerS2s: boolean;
  /** Only for roles that can edit vendors (admins and programmers). */
  secret?: string;
}

export type VendorDraft = Omit<Vendor, 'id' | 'secret' | 'partnerSecretSet'> & { id?: string; secret?: string; partnerSecretSet?: boolean };

export const emptyVendor = (): VendorDraft => ({
  name: '',
  code: '',
  integration: 'DIRECT',
  redirectMode: 'STATIC',
  staticUrls: {},
  statusWords: {},
  countryRedirects: {},
  dynamicAllowedHosts: [],
  dynamicParam: 'rurl',
  requireSignedEntry: false,
  signRedirects: false,
  callbackUrl: null,
  callbackStatuses: [],
  callbackMaxAttempts: 6,
  partnerBaseUrl: null,
  partnerS2s: true,
});

interface Callback {
  id: string;
  status: string;
  state: 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD';
  url: string;
  method: string;
  attempts: number;
  maxAttempts: number;
  lastHttpStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
}

interface RedirectEvent {
  id: string;
  uid: string;
  status: string;
  statusWord: string;
  source: string;
  level: string | null;
  url: string | null;
  reason: string | null;
  isTest: boolean;
  createdAt: string;
}

const LEVEL_NAMES: Record<string, string> = {
  vendor_country: 'vendor + country',
  vendor: 'vendor',
  project_country: 'project + country',
  project: 'project',
  organization: 'organization',
};

export function VendorEditor({
  projectId,
  vendor,
  onClose,
  onSaved,
}: {
  projectId: string;
  vendor: VendorDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState(vendor);
  const [hosts, setHosts] = useState(vendor.dynamicAllowedHosts.join(', '));
  const [partnerSecret, setPartnerSecret] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<Record<string, string | null>>({});
  const [previewReturn, setPreviewReturn] = useState('');
  const [previewCountry, setPreviewCountry] = useState('');
  const projexa = v.integration === 'PROJEXA';

  const payload = () => {
    const layer = cleanLayer({ urls: v.staticUrls, words: v.statusWords, countries: v.countryRedirects });
    return {
      name: v.name,
      code: v.code,
      integration: v.integration,
      redirectMode: v.redirectMode,
      staticUrls: layer.urls,
      statusWords: layer.words,
      countryRedirects: layer.countries,
      dynamicAllowedHosts: hosts.split(/[\s,]+/).filter(Boolean),
      dynamicParam: v.dynamicParam,
      requireSignedEntry: v.requireSignedEntry,
      signRedirects: v.signRedirects,
      callbackUrl: v.callbackUrl?.trim() ? v.callbackUrl.trim() : null,
      callbackStatuses: v.callbackStatuses,
      callbackMaxAttempts: v.callbackMaxAttempts,
      partnerBaseUrl: v.partnerBaseUrl?.trim() ? v.partnerBaseUrl.trim() : null,
      partnerS2s: v.partnerS2s,
      ...(partnerSecret ? { partnerSecret } : {}),
    };
  };

  const save = async () => {
    setError(null);
    try {
      if (v.id) await api(`/vendors/${v.id}`, { method: 'PUT', body: payload() });
      else await api(`/projects/${projectId}/vendors`, { body: payload() });
      onSaved();
    } catch (e) {
      setError(e);
    }
  };

  const runPreview = async () => {
    if (!v.id) return;
    const out: Record<string, string | null> = {};
    for (const [s] of STATUSES) {
      const r = await api<{ url: string | null; source: string; level: string | null }>(`/vendors/${v.id}/redirect-preview`, {
        body: { status: s, uid: 'TEST123', returnUrl: previewReturn || undefined, country: previewCountry || undefined },
      });
      out[s] = r.url ? `${r.url}  (${r.source}${r.level ? `, ${LEVEL_NAMES[r.level] ?? r.level}` : ''})` : null;
    }
    setPreview(out);
  };

  return (
    <section className="panel stack" style={{ marginTop: 16 }} data-testid="vendor-editor">
      <div className="row">
        <h2 style={{ margin: 0 }}>{v.id ? `Edit vendor ${vendor.name}` : 'New vendor'}</h2>
        <div style={{ flex: 1 }} />
        <button onClick={onClose}>Close</button>
      </div>
      <div className="row">
        <label className="field">
          Name
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </label>
        <label className="field">
          Vendor ID on links (vid)
          <input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />
        </label>
        <label className="field">
          Integration
          <select value={v.integration} onChange={(e) => setV({ ...v, integration: e.target.value as Vendor['integration'] })}>
            <option value="DIRECT">Direct: ZAPX redirects and calls back</option>
            <option value="PROJEXA">PROJEXA: traffic comes through PROJEXA</option>
          </select>
        </label>
        {!projexa ? (
          <label className="field">
            Redirect mode
            <select value={v.redirectMode} onChange={(e) => setV({ ...v, redirectMode: e.target.value as Vendor['redirectMode'] })}>
              <option value="STATIC">Static: fixed URL per status</option>
              <option value="DYNAMIC">Dynamic: return URL passed on the link</option>
              <option value="HYBRID">Hybrid: dynamic if passed, else static</option>
            </select>
          </label>
        ) : null}
      </div>

      {projexa ? (
        <div className="stack" data-testid="projexa-settings">
          <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>
            Built from PROJEXA&apos;s documented survey-platform contract. It has not been tested against a running PROJEXA yet, so run a
            test respondent end to end before sending live traffic.
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            In PROJEXA, set this survey&apos;s client link to the ZAPX live link with <span className="mono">vid={v.code || 'CODE'}</span>{' '}
            and <span className="mono">uid={'{session_token}'}</span>. ZAPX sends respondents to{' '}
            <span className="mono">/r/&#123;status&#125;?token=…</span> and confirms each outcome with a signed{' '}
            <span className="mono">POST /api/v1/s2s/outcome</span>.
          </p>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              PROJEXA base URL
              <input
                value={v.partnerBaseUrl ?? ''}
                placeholder="https://projexa.example.com"
                onChange={(e) => setV({ ...v, partnerBaseUrl: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              PROJEXA client secret {v.partnerSecretSet ? '(saved; leave empty to keep)' : ''}
              <input type="password" autoComplete="off" value={partnerSecret} onChange={(e) => setPartnerSecret(e.target.value)} />
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={v.partnerS2s} onChange={(e) => setV({ ...v, partnerS2s: e.target.checked })} />
            Confirm every outcome server to server (recommended by PROJEXA)
          </label>
        </div>
      ) : (
        <>
          <p className="muted small">
            Placeholders: <span className="mono">[UID] [VID] [CC] [STATUS] [RID] [param:name]</span>. Empty fields use the project defaults,
            then the organization defaults.
          </p>
          {v.redirectMode !== 'DYNAMIC' ? (
            <StatusTable
              rules={{ urls: v.staticUrls, words: v.statusWords }}
              onChange={(r) => setV({ ...v, staticUrls: r.urls, statusWords: r.words })}
              urlPlaceholder="project default"
            />
          ) : (
            <StatusTable hideUrls rules={{ urls: {}, words: v.statusWords }} onChange={(r) => setV({ ...v, statusWords: r.words })} />
          )}
          {v.redirectMode !== 'DYNAMIC' ? (
            <CountryOverrides
              scope="vendor"
              countries={v.countryRedirects}
              onChange={(countryRedirects) => setV({ ...v, countryRedirects })}
            />
          ) : null}
          {v.redirectMode !== 'STATIC' ? (
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                Allowed return hosts (comma separated; subdomains included)
                <input value={hosts} onChange={(e) => setHosts(e.target.value)} placeholder="panel.example.com" />
              </label>
              <label className="field">
                Link parameter carrying the return URL
                <input value={v.dynamicParam} onChange={(e) => setV({ ...v, dynamicParam: e.target.value })} />
              </label>
            </div>
          ) : null}
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={v.requireSignedEntry}
                onChange={(e) => setV({ ...v, requireSignedEntry: e.target.checked })}
              />
              Require signed entry links (HMAC-SHA256 <span className="mono">sig</span>, optional <span className="mono">exp</span>)
            </label>
            <label className="check">
              <input type="checkbox" checked={v.signRedirects} onChange={(e) => setV({ ...v, signRedirects: e.target.checked })} />
              Sign redirects (<span className="mono">zts</span> + <span className="mono">zsig</span>)
            </label>
          </div>
          <fieldset className="panel stack" style={{ margin: 0 }} data-testid="callback-settings">
            <legend className="small">Callbacks (server to server)</legend>
            <label className="field">
              Callback URL (GET, same placeholders)
              <input
                value={v.callbackUrl ?? ''}
                placeholder="https://panel.example.com/postback?uid=[UID]&status=[STATUS]"
                onChange={(e) => setV({ ...v, callbackUrl: e.target.value })}
              />
            </label>
            <div className="row" role="group" aria-label="Callback statuses">
              {STATUSES.map(([s, name]) => (
                <label key={s} className="check">
                  <input
                    type="checkbox"
                    checked={v.callbackStatuses.includes(s)}
                    onChange={(e) =>
                      setV({
                        ...v,
                        callbackStatuses: e.target.checked ? [...v.callbackStatuses, s] : v.callbackStatuses.filter((x) => x !== s),
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <label className="field" style={{ width: 220 }}>
              Attempts before giving up (1–10)
              <input
                type="number"
                min={1}
                max={10}
                value={v.callbackMaxAttempts}
                onChange={(e) => setV({ ...v, callbackMaxAttempts: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })}
              />
            </label>
            <p className="muted small" style={{ margin: 0 }}>
              Each callback carries <span className="mono">X-Idempotency-Key</span>, <span className="mono">X-Zapx-Timestamp</span> and{' '}
              <span className="mono">X-Zapx-Signature</span> (HMAC-SHA256 of <span className="mono">timestamp.url.body</span> with the
              shared secret). Failures are retried after 30s, 1, 2, 4… minutes, up to one hour apart. Test respondents never trigger
              callbacks.
            </p>
          </fieldset>
        </>
      )}
      {v.secret ? (
        <p className="small muted">
          Shared secret (entry links, signed redirects, callbacks and the vendor API): <span className="mono">{v.secret}</span>
        </p>
      ) : null}
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" onClick={save}>
          Save vendor
        </button>
      </div>
      {v.id ? (
        <div className="stack">
          <h3>Redirect QA</h3>
          <div className="row">
            {!projexa && v.redirectMode !== 'STATIC' ? (
              <input
                style={{ flex: 1 }}
                placeholder="Sample dynamic return URL to test"
                value={previewReturn}
                onChange={(e) => setPreviewReturn(e.target.value)}
              />
            ) : null}
            {!projexa ? (
              <input
                aria-label="Preview country"
                placeholder="Country, e.g. DE"
                value={previewCountry}
                onChange={(e) => setPreviewCountry(e.target.value)}
                style={{ width: 130 }}
              />
            ) : null}
            <button onClick={runPreview}>Preview every status for UID TEST123</button>
          </div>
          {Object.keys(preview).length ? (
            <table className="data" data-testid="redirect-preview">
              <tbody>
                {STATUSES.map(([s, label]) => (
                  <tr key={s}>
                    <td>{label}</td>
                    <td className="mono small">
                      {preview[s] ?? <span className="error-text">No redirect: respondent sees a message</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <VendorLogs vendorId={v.id} />
        </div>
      ) : null}
    </section>
  );
}

function VendorLogs({ vendorId }: { vendorId: string }) {
  const [tab, setTab] = useState<'callbacks' | 'redirects'>('callbacks');
  const [callbacks, setCallbacks] = useState<{ items: Callback[]; counts: Record<string, number> } | null>(null);
  const [events, setEvents] = useState<RedirectEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        api<{ items: Callback[]; counts: Record<string, number> }>(`/vendors/${vendorId}/callbacks`),
        api<RedirectEvent[]>(`/vendors/${vendorId}/redirect-events`),
      ]);
      setCallbacks(c);
      setEvents(e);
    } catch (err) {
      setError(err);
    }
  }, [vendorId]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack" data-testid="vendor-logs">
      <div className="row" role="tablist">
        <button role="tab" aria-selected={tab === 'callbacks'} onClick={() => setTab('callbacks')}>
          Callback deliveries
          {callbacks
            ? ` (${
                Object.entries(callbacks.counts)
                  .map(([k, n]) => `${n} ${k.toLowerCase()}`)
                  .join(', ') || 'none'
              })`
            : ''}
        </button>
        <button role="tab" aria-selected={tab === 'redirects'} onClick={() => setTab('redirects')}>
          Redirect log
        </button>
        <div style={{ flex: 1 }} />
        <button className="link" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <ErrorNote error={error} />
      {tab === 'callbacks' ? (
        !callbacks || callbacks.items.length === 0 ? (
          <p className="muted small">No callbacks yet.</p>
        ) : (
          <table className="data small">
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Delivery</th>
                <th>Request</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {callbacks.items.map((c) => (
                <tr key={c.id}>
                  <td>{new Date(c.createdAt).toLocaleString()}</td>
                  <td>{c.status}</td>
                  <td>
                    <span className={`badge ${c.state === 'DELIVERED' ? 'good' : c.state === 'PENDING' ? 'warn' : 'bad'}`}>
                      {c.state.toLowerCase()}
                    </span>
                    <div className="muted">
                      {c.attempts}/{c.maxAttempts} attempts{c.lastHttpStatus ? ` · HTTP ${c.lastHttpStatus}` : ''}
                      {c.lastError ? ` · ${c.lastError}` : ''}
                      {c.state === 'PENDING' && c.attempts > 0 ? ` · next ${new Date(c.nextAttemptAt).toLocaleTimeString()}` : ''}
                    </div>
                  </td>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {c.method} {c.url}
                  </td>
                  <td>
                    {c.state === 'FAILED' || c.state === 'DEAD' ? (
                      <button
                        onClick={async () => {
                          try {
                            await api(`/callbacks/${c.id}/replay`, { method: 'POST' });
                            await load();
                          } catch (e) {
                            setError(e);
                          }
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : !events || events.length === 0 ? (
        <p className="muted small">No redirects yet.</p>
      ) : (
        <table className="data small">
          <thead>
            <tr>
              <th>Time</th>
              <th>UID</th>
              <th>Status</th>
              <th>Rule</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td className="mono">
                  {e.uid}
                  {e.isTest ? <span className="badge"> test</span> : null}
                </td>
                <td>
                  {e.status} <span className="muted mono">[{e.statusWord}]</span>
                  {e.reason ? <div className="muted">{e.reason}</div> : null}
                </td>
                <td>{e.source === 'static' ? (LEVEL_NAMES[e.level ?? ''] ?? e.level) : e.source}</td>
                <td className="mono" style={{ wordBreak: 'break-all' }}>
                  {e.url ?? <span className="muted">no redirect</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
