'use client';
/**
 * Super admin: every integration. The platform integrations (AI, IPinfo, Deepgram, Twilio, Stripe,
 * file storage) are set up on the Integrations settings page; each organization's own integrations
 * (single sign-on, SCIM, webhooks, API keys, vendors, AI) can be allowed or blocked here.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { SuperAdminFrame } from '@/components/super-admin/SuperAdminFrame';
import { InfoTip } from '@/components/neon/InfoTip';

interface Platform {
  key: string;
  name: string;
  category: string;
  purpose: string;
  enabled: boolean;
  switchedOn: boolean;
  source: 'crm' | 'env';
  missing: string[];
}

interface OrgRow {
  id: string;
  name: string;
  sso: string | null;
  scim: boolean;
  ai: boolean;
  webhooks: number;
  apiKeys: number;
  vendors: number;
  allowed: Record<'sso' | 'webhooks' | 'api_keys' | 'integrations' | 'ai_assist', boolean>;
}

const CONTROLS: Array<{ key: keyof OrgRow['allowed']; label: string; usage: (o: OrgRow) => string }> = [
  { key: 'sso', label: 'SSO & SCIM', usage: (o) => [o.sso ?? 'off', o.scim ? 'SCIM' : ''].filter(Boolean).join(' + ') },
  { key: 'webhooks', label: 'Webhooks', usage: (o) => `${o.webhooks} active` },
  { key: 'api_keys', label: 'API keys', usage: (o) => `${o.apiKeys} active` },
  { key: 'integrations', label: 'Vendors', usage: (o) => `${o.vendors} vendors` },
  { key: 'ai_assist', label: 'AI', usage: (o) => (o.ai ? 'on' : 'off by org') },
];

function status(p: Platform) {
  if (p.enabled) return <span className="badge good">On</span>;
  if (p.switchedOn) return <span className="badge warn">Incomplete</span>;
  return <span className="badge">Off</span>;
}

export default function SuperIntegrationsPage() {
  const [data, setData] = useState<{ platform: Platform[]; organizations: OrgRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(
    () => void api<{ platform: Platform[]; organizations: OrgRow[] }>('/super/integrations').then(setData, setError),
    [],
  );
  useEffect(load, [load]);
  const toggle = (org: string, feature: string, on: boolean) =>
    api(`/super/organizations/${org}/features`, { method: 'PATCH', body: { feature, surface: 'both', on } }).then(load, setError);

  return (
    <SuperAdminFrame
      help="sa.integrations"
      title="Integrations"
      intro="The integrations of the whole installation, and which organizations may use their own."
      actions={
        <Link className="btn primary" href="/settings/integrations">
          Set up platform integrations
        </Link>
      }
    >
      <ErrorNote error={error} />
      {data ? (
        <>
          <section className="panel nx-card" data-testid="platform-integrations">
            <div className="nx-card-head">
              <h2>
                Platform integrations
                <InfoTip k="sa.integrations" />
              </h2>
              <span className="muted small">Used by every organization. Keys are entered and tested on the setup page.</span>
            </div>
            <div className="scroll-x">
              <table className="data small">
                <thead>
                  <tr>
                    <th>Integration</th>
                    <th>Used for</th>
                    <th>Status</th>
                    <th>Set in</th>
                  </tr>
                </thead>
                <tbody>
                  {data.platform.map((p) => (
                    <tr key={p.key} data-testid={`platform-${p.key}`}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="muted">{p.category}</div>
                      </td>
                      <td>{p.purpose}</td>
                      <td>
                        {status(p)}
                        {p.switchedOn && p.missing.length ? <div className="muted">Missing: {p.missing.join(', ')}</div> : null}
                      </td>
                      <td>{p.source === 'crm' ? 'CRM' : 'Server environment'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel nx-card" style={{ marginTop: 16 }} data-testid="org-integrations-table">
            <div className="nx-card-head">
              <h2>
                Organizations&rsquo; own integrations
                <InfoTip k="sa.orgOwnIntegrations" />
              </h2>
              <span className="muted small">
                Untick to block an integration for an organization (web CRM and mobile app). Applies at once.
              </span>
            </div>
            <div className="scroll-x">
              <table className="data small">
                <thead>
                  <tr>
                    <th>Organization</th>
                    {CONTROLS.map((c) => (
                      <th key={c.key}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.organizations.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/super-admin/organizations/${o.id}`}>{o.name}</Link>
                      </td>
                      {CONTROLS.map((c) => (
                        <td key={c.key}>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={o.allowed[c.key]}
                              aria-label={`${c.label} for ${o.name}`}
                              data-testid={`allow-${c.key}-${o.id}`}
                              onChange={(e) => void toggle(o.id, c.key, e.target.checked)}
                            />
                            <span className="muted">{c.usage(o)}</span>
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : !error ? (
        <div className="nx-skeleton" style={{ height: 240 }} />
      ) : null}
    </SuperAdminFrame>
  );
}
