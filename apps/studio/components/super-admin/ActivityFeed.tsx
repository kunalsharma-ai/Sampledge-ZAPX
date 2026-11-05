'use client';
import Link from 'next/link';
import { ago, fmtTime } from './SuperAdminFrame';

export interface ActivityEvent {
  id: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
  organization: { id: string; name: string | null };
  actor: { id: string; email: string | null; name: string | null; role: string | null } | null;
}

/** "survey.published" -> "Survey published". */
export const humanAction = (a: string) => {
  const s = a.replace(/^super\./, '').replace(/[._]/g, ' ');
  return s[0]!.toUpperCase() + s.slice(1);
};

/** A list of audit events from every organization, newest first. */
export function ActivityFeed({ events, showOrg = true }: { events: ActivityEvent[]; showOrg?: boolean }) {
  if (!events.length) return <p className="muted small">Nothing yet.</p>;
  return (
    <ul className="sa-feed" data-testid="activity-feed">
      {events.map((e) => (
        <li key={e.id}>
          <span className="sa-dot" aria-hidden="true" />
          <div>
            <strong>{humanAction(e.action)}</strong>
            {e.action.startsWith('super.') ? (
              <span className="badge warn" style={{ marginLeft: 6 }}>
                super admin
              </span>
            ) : null}
            <div className="small muted">
              {e.actor ? (e.actor.name ?? e.actor.email ?? 'member') : 'automation'}
              {e.actor?.role ? ` (${e.actor.role.toLowerCase()})` : ''}
              {showOrg ? (
                <>
                  {' · '}
                  <Link href={`/super-admin/organizations/${e.organization.id}`}>{e.organization.name ?? 'organization'}</Link>
                </>
              ) : null}
              {' · '}
              <time dateTime={e.at} title={fmtTime(e.at)}>
                {ago(e.at)}
              </time>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
