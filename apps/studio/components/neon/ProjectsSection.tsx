'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FolderKanban, FolderPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ErrorNote } from '@/components/Shell';

interface Project {
  id: string;
  name: string;
  client: string | null;
  createdAt: string;
  _count: { surveys: number; vendors: number };
}

/**
 * The projects table and the "New project" form. On the dashboard it shows the latest projects with
 * a "View all" link (`limit`); on the Projects page it shows all of them.
 */
export function ProjectsSection({ limit, heading, onCreated }: { limit?: number; heading?: string; onCreated?: () => void }) {
  const me = useMe();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => api<Project[]>('/projects').then(setProjects).catch(setError), []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/projects', { body: { name, client: client || undefined } });
      setName('');
      setClient('');
      await load();
      onCreated?.();
    } catch (err) {
      setError(err);
    }
  };

  const shown = projects && limit ? projects.slice(0, limit) : projects;
  const canCreate = me?.role !== 'VIEWER';

  return (
    <div className="nx-projects">
      <section className="panel nx-card">
        <div className="nx-card-head">
          {heading ? (
            <h2>
              <FolderKanban size={17} aria-hidden="true" /> {heading}
            </h2>
          ) : (
            <h2 className="sr-only">Project list</h2>
          )}
          {limit && projects && projects.length > limit ? (
            <Link href="/projects" className="small">
              View all ({projects.length})
            </Link>
          ) : null}
        </div>
        {projects === null ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet. Create your first one.</p>
        ) : (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th className="num">Surveys</th>
                  <th className="num">Vendors</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {shown!.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.client ?? '—'}</td>
                    <td className="num">{p._count.surveys}</td>
                    <td className="num">{p._count.vendors}</td>
                    <td className="muted small">{new Date(p.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canCreate ? (
        <form className="panel stack nx-card" onSubmit={create}>
          <h2>
            <FolderPlus size={17} aria-hidden="true" /> New project
          </h2>
          <label className="field">
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cardiologist brand tracker W1" />
          </label>
          <label className="field">
            Client (optional)
            <input value={client} onChange={(e) => setClient(e.target.value)} />
          </label>
          <ErrorNote error={error} />
          <button className="primary">Create project</button>
        </form>
      ) : (
        <ErrorNote error={error} />
      )}
    </div>
  );
}
