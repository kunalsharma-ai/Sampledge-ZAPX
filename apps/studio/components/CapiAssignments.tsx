'use client';
/** Face-to-face fieldwork: which interviewers may conduct this survey in the offline CAPI app. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CopyField, ErrorNote } from './Shell';

interface Person {
  id: string;
  name: string;
  email: string;
}
interface Assignment {
  id: string;
  interviewerId: string;
  interviewer: Person;
  target: number | null;
  active: boolean;
  synced: number;
  completes: number;
}

export function CapiAssignments({ surveyId, readOnly, hasLive }: { surveyId: string; readOnly: boolean; hasLive: boolean }) {
  const [data, setData] = useState<{ appUrl: string; interviewers: Person[]; assignments: Assignment[] } | null>(null);
  const [pick, setPick] = useState('');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setData(await api(`/surveys/${surveyId}/capi/assignments`));
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
  }, [load]);

  const active = data?.assignments.filter((a) => a.active) ?? [];
  const available = data?.interviewers.filter((i) => !active.some((a) => a.interviewerId === i.id)) ?? [];

  return (
    <section className="panel stack" data-testid="capi-assignments">
      <h2 style={{ margin: 0 }}>Interviewers (CAPI and phone)</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Interviewers download the live version to a tablet or phone, interview offline, and sync when they have a connection. The server
        re-checks every interview against the version it was recorded on, counts quotas and scores quality. Completes that arrive after a
        quota filled are kept as quota full. Assigned interviewers can also make phone interviews for this survey from Calls.
      </p>
      {data ? <CopyField value={data.appUrl} label="Interviewer app address" /> : null}
      {!hasLive ? <p className="small">Publish the survey before interviewers can download it.</p> : null}
      <ErrorNote error={error} />
      <table className="data">
        <thead>
          <tr>
            <th>Interviewer</th>
            <th>Target</th>
            <th>Synced</th>
            <th>Completes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.assignments.map((a) => (
            <tr key={a.id}>
              <td>
                {a.interviewer.name} <span className="muted small mono">{a.interviewer.email}</span>{' '}
                {a.active ? null : <span className="badge">ended</span>}
              </td>
              <td>{a.target ?? '—'}</td>
              <td>{a.synced}</td>
              <td>{a.completes}</td>
              <td>
                {a.active && !readOnly ? (
                  <button
                    className="link"
                    onClick={async () => {
                      try {
                        await api(`/surveys/${surveyId}/capi/assignments/${a.id}`, { method: 'DELETE' });
                        await load();
                      } catch (e) {
                        setError(e);
                      }
                    }}
                  >
                    End assignment
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.assignments.length === 0 ? <p className="muted small">No interviewers assigned.</p> : null}
      {readOnly ? null : data && data.interviewers.length === 0 ? (
        <p className="small">Add team members with the interviewer role in Settings → Team first.</p>
      ) : (
        <div className="row">
          <select aria-label="Interviewer to assign" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose an interviewer…</option>
            {available.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.email})
              </option>
            ))}
          </select>
          <input
            aria-label="Target completes"
            type="number"
            min={1}
            placeholder="Target (optional)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
          <button
            className="primary"
            disabled={!pick}
            onClick={async () => {
              setError(null);
              try {
                await api(`/surveys/${surveyId}/capi/assignments`, {
                  body: { interviewerId: pick, target: target ? Number(target) : null },
                });
                setPick('');
                setTarget('');
                await load();
              } catch (e) {
                setError(e);
              }
            }}
          >
            Assign
          </button>
        </div>
      )}
    </section>
  );
}
