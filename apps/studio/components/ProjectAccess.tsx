'use client';
/** Who can see this project. Admins add and remove members who have assigned-project access. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { InfoTip } from '@/components/neon/InfoTip';

interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  projectScope: 'ALL' | 'ASSIGNED';
  access: 'organization' | 'member';
}

interface TeamMember {
  id: string;
  name: string;
  role: string;
  projectScope: 'ALL' | 'ASSIGNED';
}

export function ProjectAccess({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setPeople(await api<Person[]>(`/projects/${projectId}/members`));
      if (isAdmin) setTeam(await api<TeamMember[]>('/users'));
    } catch (e) {
      setError(e);
    }
  }, [projectId, isAdmin]);
  useEffect(() => {
    void load();
  }, [load]);

  const addable = team.filter(
    (t) => t.projectScope === 'ASSIGNED' && t.role !== 'ADMIN' && t.role !== 'INTERVIEWER' && !people.some((p) => p.id === t.id),
  );

  return (
    <section className="panel stack" style={{ marginTop: 16 }} data-testid="project-access">
      <h2 style={{ margin: 0 }}>
        Project access
        <InfoTip k="section.projectAccess" />
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Administrators and members with access to all projects always see this project. Members with assigned project access see it only
        when they are added here.
      </p>
      <table className="data small">
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="mono">{p.email}</td>
              <td>
                <span className="badge">{p.role.toLowerCase()}</span>
              </td>
              <td>{p.access === 'organization' ? <span className="muted">all projects</span> : 'added to this project'}</td>
              <td>
                {isAdmin && p.access === 'member' ? (
                  <button
                    className="link"
                    onClick={async () => {
                      setError(null);
                      try {
                        await api(`/projects/${projectId}/members/${p.id}`, { method: 'DELETE' });
                        await load();
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    Remove {p.name}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isAdmin ? (
        addable.length ? (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!pick) return;
              setError(null);
              try {
                await api(`/projects/${projectId}/members`, { body: { userId: pick } });
                setPick('');
                await load();
              } catch (err) {
                setError(err);
              }
            }}
          >
            <select aria-label="Member to add" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a member…</option>
              {addable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.role.toLowerCase()})
                </option>
              ))}
            </select>
            <button className="primary" disabled={!pick}>
              Add to project
            </button>
          </form>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Everyone with assigned project access is already on this project. Set a member to assigned projects in Settings → Team.
          </p>
        )
      ) : null}
      <ErrorNote error={error} />
    </section>
  );
}
