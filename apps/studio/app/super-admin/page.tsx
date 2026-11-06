'use client';
/** Super admin console: overview of every organization, subscription and member on this installation. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Building2, CalendarClock, ShieldOff, Smartphone, UserCheck, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ErrorNote } from '@/components/Shell';
import { Donut, ShareBars } from '@/components/neon/Charts';
import { SuperAdminFrame, StatusBadge, fmtDate } from '@/components/super-admin/SuperAdminFrame';
import { ActivityFeed, type ActivityEvent } from '@/components/super-admin/ActivityFeed';
import { InfoTip } from '@/components/neon/InfoTip';

interface Overview {
  organizations: number;
  suspended: number;
  members: number;
  activeMembers7d: number;
  mobileMembers7d: number;
  byPlan: Array<{ plan: string; organizations: number }>;
  byStatus: Array<{ status: string; organizations: number }>;
  endingSoon: Array<{ id: string; name: string; plan: string; subscriptionEndsAt: string; subscriptionStatus: string }>;
  recentActivity: ActivityEvent[];
}

const STATUS_COLORS: Record<string, string> = {
  active: 'var(--viz-1)',
  trialing: 'var(--viz-2)',
  expired: 'var(--viz-3)',
  cancelled: 'var(--viz-4)',
};

function Kpi({
  icon: Icon,
  tone,
  value,
  label,
  sub,
  testId,
}: {
  icon: typeof Users;
  tone: number;
  value: number;
  label: string;
  sub: string;
  testId: string;
}) {
  return (
    <div className={`nx-kpi tone-${tone}`} data-testid={testId}>
      <span className="nx-kpi-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div>
        <div className="nx-kpi-value">{value.toLocaleString()}</div>
        <div className="nx-kpi-label">{label}</div>
        <div className="nx-kpi-sub">{sub}</div>
      </div>
    </div>
  );
}

export default function SuperAdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => void api<Overview>('/super/overview').then(setData, setError), []);

  return (
    <SuperAdminFrame
      help="sa.overview"
      title="Overview"
      intro="Every organization on this installation: their subscriptions, members and what they do. Register organizations, set what each plan includes on the web CRM and the mobile app, and automate subscription handling."
      actions={
        <Link className="btn primary" href="/super-admin/organizations?new=1">
          Register organization
        </Link>
      }
    >
      <ErrorNote error={error} />
      {data ? (
        <>
          <section className="nx-kpis" aria-label="Key numbers">
            <Kpi icon={Building2} tone={0} value={data.organizations} label="Organizations" sub="registered" testId="kpi-orgs" />
            <Kpi icon={ShieldOff} tone={4} value={data.suspended} label="Suspended" sub="cannot sign in" testId="kpi-suspended" />
            <Kpi icon={Users} tone={1} value={data.members} label="Members" sub="active accounts" testId="kpi-members" />
            <Kpi icon={UserCheck} tone={3} value={data.activeMembers7d} label="Active" sub="last 7 days" testId="kpi-active" />
            <Kpi icon={Smartphone} tone={2} value={data.mobileMembers7d} label="On mobile" sub="last 7 days" testId="kpi-mobile" />
          </section>
          <div className="sa-grid">
            <section className="panel nx-card">
              <div className="nx-card-head">
                <h2>
                  Subscriptions
                  <InfoTip k="sa.subscriptions" />
                </h2>
                <Link href="/super-admin/plans" className="small">
                  Plans &amp; features
                </Link>
              </div>
              <Donut
                slices={data.byStatus.map((s) => ({
                  key: s.status,
                  label: s.status,
                  value: s.organizations,
                  color: STATUS_COLORS[s.status] ?? 'var(--viz-4)',
                }))}
                total={data.organizations}
                centerLabel="organizations"
                caption="Organizations by subscription status"
              />
              <h3 className="small muted">By plan</h3>
              <ShareBars
                rows={data.byPlan.map((p) => ({ key: p.plan, label: p.plan, value: p.organizations }))}
                total={data.organizations}
              />
            </section>
            <section className="panel nx-card" data-testid="ending-soon">
              <div className="nx-card-head">
                <h2>
                  <CalendarClock size={18} aria-hidden="true" /> Ending in the next 30 days
                  <InfoTip k="sa.ending" />
                </h2>
                <Link href="/super-admin/automation" className="small">
                  Automate renewals
                </Link>
              </div>
              {data.endingSoon.length ? (
                <table className="data small">
                  <tbody>
                    {data.endingSoon.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/super-admin/organizations/${o.id}`}>{o.name}</Link>
                        </td>
                        <td>{o.plan}</td>
                        <td>
                          <StatusBadge status={o.subscriptionStatus} />
                        </td>
                        <td>{fmtDate(o.subscriptionEndsAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted small">No subscription ends in the next 30 days.</p>
              )}
            </section>
            <section className="panel nx-card">
              <div className="nx-card-head">
                <h2>
                  Latest activity
                  <InfoTip k="sa.activity" />
                </h2>
                <Link href="/super-admin/activity" className="small">
                  All activity
                </Link>
              </div>
              <ActivityFeed events={data.recentActivity} />
            </section>
          </div>
        </>
      ) : !error ? (
        <div className="nx-skeleton" style={{ height: 240 }} />
      ) : null}
    </SuperAdminFrame>
  );
}
