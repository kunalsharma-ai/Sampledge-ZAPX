'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote, Shell } from '@/components/Shell';

const STATUSES = [
  ['complete', 'Complete'],
  ['terminate', 'Terminate'],
  ['quota_full', 'Quota full'],
  ['security_reject', 'Security reject'],
  ['quality_fail', 'Quality fail'],
  ['duplicate', 'Duplicate'],
] as const;
type Status = (typeof STATUSES)[number][0];

interface Vendor {
  id: string;
  name: string;
  code: string;
  redirectMode: 'STATIC' | 'DYNAMIC' | 'HYBRID';
  staticUrls: Partial<Record<Status, string>>;
  statusWords: Partial<Record<Status, string>>;
  dynamicAllowedHosts: string[];
  dynamicParam: string;
  requireSignedEntry: boolean;
  signRedirects: boolean;
  secret: string;
}

interface Project {
  id: string;
  name: string;
  client: string | null;
  surveys: Array<{ id: string; name: string; status: string; updatedAt: string }>;
}

const emptyVendor = (): Omit<Vendor, 'id' | 'secret'> => ({
  name: '',
  code: '',
  redirectMode: 'STATIC',
  staticUrls: {},
  statusWords: {},
  dynamicAllowedHosts: [],
  dynamicParam: 'rurl',
  requireSignedEntry: false,
  signRedirects: false,
});

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [surveyName, setSurveyName] = useState('');
  const [editing, setEditing] = useState<(Omit<Vendor, 'id' | 'secret'> & { id?: string; secret?: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setProject(await api<Project>(`/projects/${id}`));
      setVendors(await api<Vendor[]>(`/projects/${id}/vendors`));
    } catch (e) {
      setError(e);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const createSurvey = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const s = await api<{ id: string }>(`/projects/${id}/surveys`, { body: { name: surveyName } });
      window.location.href = `/surveys/${s.id}`;
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Shell crumbs={<Link href="/">Projects</Link>}>
      {!project ? (
        <ErrorNote error={error} />
      ) : (
        <>
          <h1>{project.name}</h1>
          <p className="muted">{project.client ? `Client: ${project.client}` : 'No client set'}</p>
          <div className="grid2" style={{ marginTop: 16 }}>
            <section className="panel stack">
              <h2>Surveys</h2>
              {project.surveys.length === 0 ? <p className="muted">No surveys yet.</p> : null}
              <table className="data">
                <tbody>
                  {project.surveys.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/surveys/${s.id}`}>{s.name}</Link>
                      </td>
                      <td>
                        <span className={`badge ${s.status.toLowerCase()}`}>{s.status.toLowerCase()}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form className="row" onSubmit={createSurvey}>
                <input required placeholder="New survey name" value={surveyName} onChange={(e) => setSurveyName(e.target.value)} />
                <button className="primary">Create survey</button>
              </form>
            </section>

            <section className="panel stack">
              <div className="row">
                <h2 style={{ margin: 0 }}>Sample vendors</h2>
                <div style={{ flex: 1 }} />
                <button onClick={() => setEditing({ ...emptyVendor(), name: 'Sampledge', code: 'SE', ...presetSampledge() })}>+ Sampledge preset</button>
                <button onClick={() => setEditing(emptyVendor())}>+ Custom vendor</button>
              </div>
              {vendors.length === 0 ? <p className="muted">Add a vendor to send live traffic. Each vendor has its own redirects.</p> : null}
              <table className="data">
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <strong>{v.name}</strong> <span className="mono muted">vid={v.code}</span>
                      </td>
                      <td>
                        <span className="badge">{v.redirectMode.toLowerCase()}</span>
                        {v.requireSignedEntry ? <span className="badge good"> signed entry</span> : null}
                      </td>
                      <td>
                        <button className="link" onClick={() => setEditing(v)}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          {editing ? (
            <VendorEditor
              projectId={id}
              vendor={editing}
              onClose={() => setEditing(null)}
              onSaved={async () => {
                setEditing(null);
                await load();
              }}
            />
          ) : null}
          <ErrorNote error={error} />
        </>
      )}
    </Shell>
  );
}

function presetSampledge(): Partial<Vendor> {
  const url = 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]';
  return {
    redirectMode: 'STATIC',
    staticUrls: { complete: url, terminate: url, quota_full: url, security_reject: url },
    statusWords: { complete: 'complete', terminate: 'terminate', quota_full: 'overquota', security_reject: 'security', quality_fail: 'terminate', duplicate: 'security' },
  };
}

function VendorEditor({
  projectId,
  vendor,
  onClose,
  onSaved,
}: {
  projectId: string;
  vendor: Omit<Vendor, 'id' | 'secret'> & { id?: string; secret?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState(vendor);
  const [hosts, setHosts] = useState(vendor.dynamicAllowedHosts.join(', '));
  const [error, setError] = useState<unknown>(null);
  const [preview, setPreview] = useState<Record<string, string | null>>({});
  const [previewReturn, setPreviewReturn] = useState('');

  const payload = () => {
    const clean = <T extends Record<string, string | undefined>>(m: T) => Object.fromEntries(Object.entries(m).filter(([, x]) => x && x.trim() !== ''));
    return {
      name: v.name,
      code: v.code,
      redirectMode: v.redirectMode,
      staticUrls: clean(v.staticUrls),
      statusWords: clean(v.statusWords),
      dynamicAllowedHosts: hosts.split(/[\s,]+/).filter(Boolean),
      dynamicParam: v.dynamicParam,
      requireSignedEntry: v.requireSignedEntry,
      signRedirects: v.signRedirects,
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
      const r = await api<{ url: string | null; source: string }>(`/vendors/${v.id}/redirect-preview`, {
        body: { status: s, uid: 'TEST123', returnUrl: previewReturn || undefined },
      });
      out[s] = r.url ? `${r.url}  (${r.source})` : null;
    }
    setPreview(out);
  };

  return (
    <section className="panel stack" style={{ marginTop: 16 }}>
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
          Redirect mode
          <select value={v.redirectMode} onChange={(e) => setV({ ...v, redirectMode: e.target.value as Vendor['redirectMode'] })}>
            <option value="STATIC">Static: fixed URL per status</option>
            <option value="DYNAMIC">Dynamic: return URL passed on the link</option>
            <option value="HYBRID">Hybrid: dynamic if passed, else static</option>
          </select>
        </label>
      </div>
      <p className="muted small">
        Placeholders: <span className="mono">[UID] [VID] [CC] [STATUS] [RID] [param:name]</span>. [STATUS] is replaced with the status word below.
      </p>
      {v.redirectMode !== 'DYNAMIC' ? (
        <table className="data list-editor">
          <thead>
            <tr>
              <th>Status</th>
              <th>Static redirect URL</th>
              <th>Status word for [STATUS]</th>
            </tr>
          </thead>
          <tbody>
            {STATUSES.map(([s, label]) => (
              <tr key={s}>
                <td>{label}</td>
                <td>
                  <input
                    aria-label={`${label} URL`}
                    style={{ width: '100%' }}
                    placeholder={s === 'duplicate' ? 'uses Security reject URL if empty' : s === 'quality_fail' ? 'uses Terminate URL if empty' : 'https://…'}
                    value={v.staticUrls[s] ?? ''}
                    onChange={(e) => setV({ ...v, staticUrls: { ...v.staticUrls, [s]: e.target.value } })}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${label} status word`}
                    placeholder={s}
                    value={v.statusWords[s] ?? ''}
                    onChange={(e) => setV({ ...v, statusWords: { ...v.statusWords, [s]: e.target.value } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <input type="checkbox" checked={v.requireSignedEntry} onChange={(e) => setV({ ...v, requireSignedEntry: e.target.checked })} />
          Require signed entry links (HMAC-SHA256 <span className="mono">sig</span>, optional <span className="mono">exp</span>)
        </label>
        <label className="check">
          <input type="checkbox" checked={v.signRedirects} onChange={(e) => setV({ ...v, signRedirects: e.target.checked })} />
          Sign redirects (<span className="mono">zsig</span>)
        </label>
      </div>
      {v.secret ? (
        <p className="small muted">
          Shared secret: <span className="mono">{v.secret}</span>
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
            {v.redirectMode !== 'STATIC' ? (
              <input style={{ flex: 1 }} placeholder="Sample dynamic return URL to test" value={previewReturn} onChange={(e) => setPreviewReturn(e.target.value)} />
            ) : null}
            <button onClick={runPreview}>Preview every status for UID TEST123</button>
          </div>
          {Object.keys(preview).length ? (
            <table className="data">
              <tbody>
                {STATUSES.map(([s, label]) => (
                  <tr key={s}>
                    <td>{label}</td>
                    <td className="mono small">{preview[s] ?? <span className="error-text">No redirect: respondent sees a message</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
