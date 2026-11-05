'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote, Shell } from '@/components/Shell';
import { VendorEditor, emptyVendor, type Vendor, type VendorDraft } from '@/components/VendorEditor';
import { LayerEditor, emptyLayer, type Layer } from '@/components/RedirectRules';
import { ProjectAccess } from '@/components/ProjectAccess';
import { useMe } from '@/lib/useMe';
import { PageHeader } from '@/components/neon/PageHeader';
import { FolderOpen } from 'lucide-react';
import { useConfirm } from '@/components/neon/ConfirmDialog';

interface Project {
  id: string;
  name: string;
  client: string | null;
  surveys: Array<{ id: string; name: string; status: string; updatedAt: string }>;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const confirm = useConfirm();
  const { id } = use(params);
  const me = useMe();
  const [project, setProject] = useState<Project | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [surveyName, setSurveyName] = useState('');
  const [editing, setEditing] = useState<VendorDraft | null>(null);
  const [defaults, setDefaults] = useState<Layer | null>(null);
  const [showDefaults, setShowDefaults] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setProject(await api<Project>(`/projects/${id}`));
      setVendors(await api<Vendor[]>(`/projects/${id}/vendors`));
      setDefaults({ ...emptyLayer(), ...(await api<Layer>(`/projects/${id}/redirect-defaults`)) });
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
    <Shell crumbs={<Link href="/">Dashboard</Link>}>
      {!project ? (
        <ErrorNote error={error} />
      ) : (
        <>
          <PageHeader icon={FolderOpen} eyebrow="Project" title={project.name}>
            {project.client ? `Client: ${project.client}` : 'No client set'}
          </PageHeader>
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
                <button onClick={() => setEditing({ ...emptyVendor(), name: 'Sampledge', code: 'SE', ...presetSampledge() })}>
                  + Sampledge preset
                </button>
                <button onClick={() => setEditing(emptyVendor())}>+ Custom vendor</button>
                <button onClick={() => setEditing({ ...emptyVendor(), name: 'PROJEXA', code: 'PX', integration: 'PROJEXA' })}>
                  + PROJEXA
                </button>
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
                        {v.integration === 'PROJEXA' ? (
                          <span className="badge">projexa</span>
                        ) : (
                          <span className="badge">{v.redirectMode.toLowerCase()}</span>
                        )}
                        {v.requireSignedEntry ? <span className="badge good"> signed entry</span> : null}
                        {v.callbackUrl ? <span className="badge"> callbacks</span> : null}
                      </td>
                      <td>
                        <button className="link" onClick={() => setEditing(v)}>
                          Edit
                        </button>{' '}
                        <button
                          className="link"
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: `Delete vendor ${v.name}?`,
                                message: 'Its links stop working; its history is kept.',
                                confirmLabel: 'Delete',
                                tone: 'danger',
                              }))
                            )
                              return;
                            try {
                              await api(`/vendors/${v.id}`, { method: 'DELETE' });
                              if (editing?.id === v.id) setEditing(null);
                              await load();
                            } catch (e) {
                              setError(e);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <section className="panel stack" style={{ marginTop: 16 }} data-testid="project-redirect-defaults">
            <div className="row">
              <h2 style={{ margin: 0 }}>Project redirect defaults</h2>
              <span className="muted small">Used by direct vendors for any status or word they leave empty.</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setShowDefaults(!showDefaults)} aria-expanded={showDefaults}>
                {showDefaults ? 'Hide' : 'Edit defaults'}
              </button>
            </div>
            {showDefaults && defaults ? (
              <LayerEditor
                scope="project"
                initial={defaults}
                onSave={async (l) => {
                  setDefaults(await api<Layer>(`/projects/${id}/redirect-defaults`, { method: 'PUT', body: l }));
                }}
              />
            ) : null}
          </section>
          <ProjectAccess projectId={id} isAdmin={me?.role === 'ADMIN'} />
          {editing ? (
            <VendorEditor
              projectId={id}
              key={editing.id ?? 'new'}
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

function presetSampledge(): Partial<VendorDraft> {
  const url = 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]';
  return {
    redirectMode: 'STATIC',
    staticUrls: { complete: url, terminate: url, quota_full: url, security_reject: url },
    statusWords: {
      complete: 'complete',
      terminate: 'terminate',
      quota_full: 'overquota',
      security_reject: 'security',
      quality_fail: 'terminate',
      duplicate: 'security',
      partial: 'terminate',
      technical_error: 'terminate',
    },
  };
}
