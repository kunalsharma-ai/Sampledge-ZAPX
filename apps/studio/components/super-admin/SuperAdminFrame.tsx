'use client';
/**
 * Super admin console: the frame every console page shares (sidebar shell, title, section tabs) and
 * the access check. The API refuses every console route to anyone but a signed-in super admin; this
 * only avoids showing an empty page.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Activity, Building2, CreditCard, LayoutGrid, PlugZap, Users, Workflow } from 'lucide-react';
import { Shell } from '@/components/Shell';
import { useMe } from '@/lib/useMe';

const SECTIONS = [
  { href: '/super-admin', label: 'Overview', icon: LayoutGrid },
  { href: '/super-admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/super-admin/plans', label: 'Plans & features', icon: CreditCard },
  { href: '/super-admin/members', label: 'Members', icon: Users },
  { href: '/super-admin/activity', label: 'Activity', icon: Activity },
  { href: '/super-admin/integrations', label: 'Integrations', icon: PlugZap },
  { href: '/super-admin/automation', label: 'Automation', icon: Workflow },
];

export function SuperAdminFrame({
  title,
  intro,
  actions,
  children,
}: {
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const me = useMe();
  const path = usePathname() ?? '';
  const crumbs = (
    <>
      <Link href="/super-admin">Super admin</Link> / {title}
    </>
  );
  if (me && !me.superAdmin)
    return (
      <Shell crumbs={crumbs}>
        <section className="panel" data-testid="super-admin-denied">
          <h1>Super admin only</h1>
          <p className="muted">This console is for the super admin of this ZAPX installation.</p>
        </section>
      </Shell>
    );
  return (
    <Shell crumbs={crumbs}>
      <div className="sa-head">
        <div>
          <h1 className="sa-title">
            <span className="nx-gradient-text">Super admin</span> · {title}
          </h1>
          {intro ? <p className="muted small sa-intro">{intro}</p> : null}
        </div>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      <nav className="sa-tabs" aria-label="Super admin sections">
        {SECTIONS.map((s) => {
          const active = s.href === '/super-admin' ? path === s.href : path === s.href || path.startsWith(`${s.href}/`);
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href} className={`sa-tab${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon size={15} aria-hidden="true" /> {s.label}
            </Link>
          );
        })}
      </nav>
      {me ? children : <div className="nx-skeleton" style={{ height: 240 }} />}
    </Shell>
  );
}

/** A plan as GET /api/super/plans lists it (the fields most pages need). */
export interface PlanRow {
  code: string;
  name: string;
  active: boolean;
}

export const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—');
export const fmtTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** "3 days ago" style time, for last-active columns. */
export function ago(v: string | null | undefined) {
  if (!v) return 'never';
  const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

export function StatusBadge({ status, suspended }: { status: string; suspended?: boolean }) {
  if (suspended)
    return (
      <span className="badge bad" data-testid="org-status">
        Suspended
      </span>
    );
  const tone = status === 'active' ? 'good' : status === 'trialing' ? 'warn' : 'bad';
  return (
    <span className={`badge ${tone}`} data-testid="org-status">
      {status === 'trialing' ? 'Trial' : status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}
