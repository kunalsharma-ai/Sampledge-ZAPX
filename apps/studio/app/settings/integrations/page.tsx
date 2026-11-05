'use client';
/**
 * Settings > Integrations: the platform operator's administrators paste keys, test the connection and
 * turn each provider on or off. Saved values win over the server's environment; secrets are never
 * shown again (only their last four characters). Every change and test is in the audit log.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { CopyField, ErrorNote, Shell } from '@/components/Shell';
import { PageHeader } from '@/components/neon/PageHeader';
import { Plug } from 'lucide-react';
import { useConfirm } from '@/components/neon/ConfirmDialog';

interface Field {
  name: string;
  label: string;
  help: string | null;
  secret: boolean;
  required: boolean;
  kind: 'text' | 'json' | 'select';
  options: string[] | null;
  placeholder: string | null;
  env: string;
  origin: 'crm' | 'env' | 'default' | 'none';
  value: string | null;
  isSet: boolean;
  hint: string | null;
}

interface Integration {
  key: string;
  name: string;
  category: string;
  purpose: string;
  privacy: string;
  signupUrl: string;
  warning: string | null;
  enabled: boolean;
  switchedOn: boolean;
  source: 'crm' | 'env';
  missing: string[];
  updatedAt: string | null;
  callbacks: Array<{ label: string; url: string }>;
  fields: Field[];
}

interface TestResult {
  ok: boolean;
  message: string;
  testedAt: string;
}

const ORIGIN: Record<Field['origin'], string> = {
  crm: 'saved here',
  env: 'server setting',
  default: 'default',
  none: '',
};

/** Set up per organization, on the main settings page. */
const ELSEWHERE = [
  { name: 'Single sign-on (OIDC and SAML)', where: 'Organization settings › Single sign-on' },
  { name: 'SCIM user provisioning', where: 'Organization settings › SCIM provisioning' },
  { name: 'Webhooks', where: 'Organization settings › Webhooks' },
  { name: 'API keys', where: 'Organization settings › API keys' },
  { name: 'AI limits and budget per organization', where: 'Organization settings › AI' },
  { name: 'PROJEXA, panels and other sample vendors', where: 'Each project › Vendors (choose PROJEXA as the integration)' },
];

function status(i: Integration): { text: string; cls: string } {
  if (i.enabled) return { text: 'On', cls: 'badge good' };
  if (i.switchedOn) return { text: 'Incomplete', cls: 'badge warn' };
  if (i.fields.some((f) => f.required && f.isSet)) return { text: 'Off', cls: 'badge' };
  return { text: 'Not set up', cls: 'badge' };
}

function IntegrationCard({ initial }: { initial: Integration }) {
  const confirm = useConfirm();
  const [it, setIt] = useState(initial);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState(initial.switchedOn);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const s = status(it);

  const startEdit = () => {
    setDraft(Object.fromEntries(it.fields.filter((f) => !f.secret).map((f) => [f.name, f.origin === 'crm' ? (f.value ?? '') : ''])));
    setEnabled(it.switchedOn);
    setOpen(true);
    setSaved(false);
    setError(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = (on = enabled) =>
    run(async () => {
      const next = await api<Integration>(`/platform/integrations/${it.key}`, { method: 'PUT', body: { enabled: on, values: draft } });
      setIt(next);
      setEnabled(next.switchedOn);
      setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !next.fields.find((f) => f.name === k)?.secret)));
      setSaved(true);
    });

  const testNow = () =>
    run(async () => {
      setTest(await api<TestResult>(`/platform/integrations/${it.key}/test`, { method: 'POST', body: { values: open ? draft : {} } }));
    });

  const reset = () =>
    run(async () => {
      if (
        !(await confirm({
          title: `Forget everything saved here for ${it.name}?`,
          message: 'It will use the server environment again.',
          confirmLabel: 'Forget settings',
          tone: 'danger',
        }))
      )
        return;
      const next = await api<Integration>(`/platform/integrations/${it.key}`, { method: 'DELETE' });
      setIt(next);
      setOpen(false);
      setTest(null);
    });

  return (
    <section className="panel stack" data-testid={`integration-${it.key}`}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>{it.name}</h2>
        <span className={s.cls} data-testid="integration-status">
          {s.text}
        </span>
        <div style={{ flex: 1 }} />
        <span className="muted small">{it.category}</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {it.purpose}
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        {it.privacy}
      </p>
      {it.source === 'env' && it.switchedOn ? (
        <p className="muted small" style={{ margin: 0 }}>
          Running from the server environment. Saving here takes over from it.
        </p>
      ) : null}
      {it.switchedOn && it.missing.length ? (
        <p className="warn-text small" style={{ margin: 0 }}>
          Still needed: {it.missing.map((m) => it.fields.find((f) => f.name === m)?.label ?? m).join(', ')}.
        </p>
      ) : null}

      {!open ? (
        <table className="data small" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '38%' }} />
            <col />
            <col style={{ width: '100px' }} />
          </colgroup>
          <tbody>
            {it.fields.map((f) => (
              <tr key={f.name}>
                <td>{f.label}</td>
                <td className="mono" style={{ wordBreak: 'break-all' }}>
                  {f.secret ? (f.isSet ? (f.hint ?? 'set') : '—') : f.value || '—'}
                </td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                  {ORIGIN[f.origin]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="stack">
          {it.fields.map((f) => {
            const id = `${it.key}-${f.name}`;
            const placeholder = f.secret
              ? f.isSet
                ? `Saved (${f.hint ?? 'set'}${f.origin === 'env' ? ', from the server' : ''}). Leave empty to keep it.`
                : (f.placeholder ?? 'Paste it here')
              : f.origin === 'env' || f.origin === 'default'
                ? `${f.value} (${ORIGIN[f.origin]})`
                : (f.placeholder ?? '');
            return (
              <label key={f.name} className="field" htmlFor={id}>
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
                {f.kind === 'select' ? (
                  <select id={id} value={draft[f.name] ?? ''} onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}>
                    <option value="">{f.value ? `${f.value} (${ORIGIN[f.origin] || 'current'})` : 'Choose'}</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : f.kind === 'json' ? (
                  <textarea
                    id={id}
                    rows={3}
                    className="mono"
                    placeholder={placeholder}
                    value={draft[f.name] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                  />
                ) : (
                  <input
                    id={id}
                    type={f.secret ? 'password' : 'text'}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={placeholder}
                    value={draft[f.name] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
                  />
                )}
                <span className="muted small">
                  {f.help ? `${f.help} ` : ''}
                  Server variable: <span className="mono">{f.env}</span>
                </span>
              </label>
            );
          })}
          <label className="check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Turn {it.name} on
          </label>
          {it.warning ? <p className="warn-text small">{it.warning}</p> : null}
        </div>
      )}

      {it.callbacks.map((c) => (
        <div key={c.url} className="stack" style={{ gap: 4 }}>
          <span className="small">{c.label}</span>
          <CopyField value={c.url} label={c.label} />
        </div>
      ))}

      <ErrorNote error={error} />
      {test ? (
        <p className={test.ok ? 'ok-text small' : 'error-text small'} role="status" data-testid="integration-test-result">
          {test.ok ? '✓ ' : '✗ '}
          {test.message}
        </p>
      ) : null}

      <div className="row">
        {open ? (
          <>
            <button className="primary" disabled={busy} onClick={() => void save()}>
              Save
            </button>
            <button disabled={busy} onClick={() => void testNow()}>
              Test connection
            </button>
            <button className="link" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="primary" onClick={startEdit}>
              {it.fields.some((f) => f.origin === 'crm' || f.origin === 'env') ? 'Edit' : 'Set up'}
            </button>
            <button disabled={busy || it.fields.every((f) => !f.isSet)} onClick={() => void testNow()}>
              Test connection
            </button>
            {it.switchedOn && it.source === 'crm' ? (
              <button disabled={busy} onClick={() => void save(false)}>
                Turn off
              </button>
            ) : null}
            {it.source === 'crm' ? (
              <button className="link small" disabled={busy} onClick={() => void reset()}>
                Use server settings instead
              </button>
            ) : null}
          </>
        )}
        {saved ? <span className="ok-text small">Saved. Takes effect within a few seconds.</span> : null}
        <div style={{ flex: 1 }} />
        <a className="small" href={it.signupUrl} target="_blank" rel="noreferrer noopener">
          Get keys
        </a>
      </div>
    </section>
  );
}

export default function IntegrationsPage() {
  const me = useMe();
  const [items, setItems] = useState<Integration[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!me?.canManageIntegrations) return;
    try {
      setItems((await api<{ integrations: Integration[] }>('/platform/integrations')).integrations);
    } catch (e) {
      setError(e);
    }
  }, [me]);
  useEffect(() => {
    void load();
  }, [load]);

  const crumbs = (
    <>
      <Link href="/">Projects</Link> / <Link href="/settings">Settings</Link>
    </>
  );
  if (me && !me.canManageIntegrations) {
    return (
      <Shell crumbs={crumbs}>
        <PageHeader icon={Plug} tone={2} eyebrow="Administration" title="Integrations" />
        <p className="muted">
          Integrations are managed by the administrators of the organization that runs this installation. Your organization&apos;s own
          single sign-on, SCIM, webhooks and API keys are on the <Link href="/settings">settings page</Link>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell crumbs={crumbs}>
      <PageHeader icon={Plug} tone={2} eyebrow="Administration" title="Integrations">
        Connect the services ZAPX uses for every organization on this installation. Paste a key, test the connection, then turn it on. Keys
        are stored encrypted and are never shown again; every change and test is recorded in the{' '}
        <Link href="/settings/audit">audit log</Link>. Anything saved here takes over from the server environment.
      </PageHeader>
      <ErrorNote error={error} />
      <div className="grid2" style={{ marginTop: 16 }}>
        {(items ?? []).map((i) => (
          <IntegrationCard key={i.key} initial={i} />
        ))}
        <section className="panel stack" data-testid="integrations-elsewhere">
          <h2>Set up per organization</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Each organization connects these itself on its <Link href="/settings">settings page</Link>, so customers can bring their own:
          </p>
          <table className="data small">
            <tbody>
              {ELSEWHERE.map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td className="muted">{e.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel stack" data-testid="integrations-developer">
          <h2>Still set on the server</h2>
          <p className="muted small" style={{ margin: 0 }}>
            These protect or run the server itself, so they cannot be changed from a web page. A developer sets them once at deployment (see
            the go-live guide):
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>The database address and password</li>
            <li>The two master keys: JWT_SECRET (sign-in sessions) and SECRETS_KEY (encrypts the keys saved on this page)</li>
            <li>The web addresses (STUDIO_URL, RUNTIME_BASE_URL), HTTPS and COOKIE_SECURE</li>
            <li>The AWS resources: servers, load balancer, CDN, firewall, backups and the S3 bucket itself (Terraform)</li>
            <li>The CDN shared secret and proxy settings, and where the background worker runs</li>
          </ul>
        </section>
      </div>
    </Shell>
  );
}
