'use client';
/** Super admin: everything admins and their members did, across every organization, newest first. */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { SuperAdminFrame } from '@/components/super-admin/SuperAdminFrame';
import { ActivityFeed, type ActivityEvent } from '@/components/super-admin/ActivityFeed';

interface Page {
  events: ActivityEvent[];
  next: string | null;
}

const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'auth.', label: 'Sign-ins' },
  { value: 'survey', label: 'Surveys' },
  { value: 'user.', label: 'Team' },
  { value: 'super.', label: 'Super admin' },
  { value: 'platform.', label: 'Integrations' },
];

export default function ActivityPage() {
  const [orgs, setOrgs] = useState<Array<{ id: string; name: string }>>([]);
  const [org, setOrg] = useState('');
  const [kind, setKind] = useState('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('org');
    if (fromUrl) setOrg(fromUrl);
    void api<Array<{ id: string; name: string }>>('/super/organizations').then(setOrgs, setError);
  }, []);

  const query = useCallback(
    (before?: string) => {
      const p = new URLSearchParams({
        limit: '50',
        ...(org ? { tenantId: org } : {}),
        ...(kind ? { action: kind } : {}),
        ...(before ? { before } : {}),
      });
      return api<Page>(`/super/activity?${p}`);
    },
    [org, kind],
  );
  useEffect(() => {
    void query().then((p) => {
      setEvents(p.events);
      setNext(p.next);
    }, setError);
  }, [query]);

  return (
    <SuperAdminFrame
      help="sa.activity"
      title="Activity"
      intro="Sign-ins, survey changes, team changes, integration changes and every super admin action, from all organizations."
    >
      <ErrorNote error={error} />
      <section className="panel nx-card stack">
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ minWidth: 220 }}>
            Organization
            <select value={org} onChange={(e) => setOrg(e.target.value)} data-testid="activity-org">
              <option value="">All organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="sa-pill-row" role="group" aria-label="Kind of activity">
            {KINDS.map((k) => (
              <button
                key={k.value}
                className={kind === k.value ? 'primary small' : 'small'}
                aria-pressed={kind === k.value}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <ActivityFeed events={events} />
        {next ? (
          <button
            onClick={() =>
              void query(next).then((p) => {
                setEvents((cur) => [...cur, ...p.events]);
                setNext(p.next);
              }, setError)
            }
          >
            Show older
          </button>
        ) : null}
      </section>
    </SuperAdminFrame>
  );
}
