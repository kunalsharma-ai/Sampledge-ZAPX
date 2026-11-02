'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote, Shell } from '@/components/Shell';

interface Project {
  id: string;
  name: string;
  client: string | null;
  createdAt: string;
  _count: { surveys: number; vendors: number };
}

export default function ProjectsPage() {
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
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Shell>
      <h1>Projects</h1>
      <p className="muted">Each project holds its surveys and the sample vendors sending traffic to them.</p>
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          {projects === null ? (
            <p className="muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="muted">No projects yet. Create your first one.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Client</th>
                  <th>Surveys</th>
                  <th>Vendors</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/projects/${p.id}`}>{p.name}</Link>
                    </td>
                    <td>{p.client ?? '—'}</td>
                    <td>{p._count.surveys}</td>
                    <td>{p._count.vendors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <form className="panel stack" onSubmit={create}>
          <h2>New project</h2>
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
      </div>
    </Shell>
  );
}
