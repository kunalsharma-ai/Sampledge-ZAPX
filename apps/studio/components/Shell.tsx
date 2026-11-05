'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Palette,
  PhoneCall,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { api, hasFeature, type Me } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { ThemeMenu } from '@/components/quantum/ThemeMenu';
import { GlobalSearch } from '@/components/neon/GlobalSearch';
import { NotificationBell } from '@/components/NotificationBell';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also active on these path prefixes. */
  match?: string[];
}

function navFor(me: Me | null): NavItem[] {
  if (!me) return [];
  // Entries whose feature the super admin switched off for this organization or member are hidden.
  const on = (key: string) => hasFeature(me, key);
  if (me.role === 'INTERVIEWER')
    return [
      ...(on('cati') || on('calls') ? [{ href: '/calls', label: 'Calls', icon: PhoneCall }] : []),
      { href: '/appearance', label: 'Appearance', icon: Palette },
    ];
  const items: NavItem[] = [];
  if (me.superAdmin) items.push({ href: '/super-admin', label: 'Super admin', icon: ShieldCheck });
  if (on('dashboard')) items.push({ href: '/', label: 'Dashboard', icon: LayoutDashboard });
  if (on('projects')) items.push({ href: '/projects', label: 'Projects', icon: FolderKanban, match: ['/projects', '/surveys'] });
  if (on('library')) items.push({ href: '/library', label: 'Question bank', icon: Library });
  if (me.role !== 'VIEWER' && (on('cati') || on('calls'))) items.push({ href: '/calls', label: 'Fieldwork calls', icon: PhoneCall });
  if (on('automation')) items.push({ href: '/automation', label: 'Automation', icon: Workflow });
  items.push({ href: '/appearance', label: 'Themes & appearance', icon: Palette });
  if (me.role === 'ADMIN') {
    if (on('settings')) items.push({ href: '/settings', label: 'Settings', icon: Settings });
    if (on('audit_log')) items.push({ href: '/settings/audit', label: 'Audit log', icon: ScrollText });
  } else if (me.role === 'PROGRAMMER' && on('api_keys')) items.push({ href: '/settings', label: 'API keys', icon: KeyRound });
  return items;
}

function isActive(item: NavItem, path: string) {
  if (item.href === '/') return path === '/';
  if (item.href === '/settings') return path === '/settings';
  return [item.href, ...(item.match ?? [])].some((p) => path === p || path.startsWith(`${p}/`));
}

interface PlanSummary {
  plan: { name: string };
  limits: { completesPerMonth: number | null };
  usage: { completesThisMonth: number };
}

/** The organization's plan and this month's completes, from GET /api/plan. */
function PlanCard({ me }: { me: Me }) {
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  useEffect(() => {
    if (me.role === 'INTERVIEWER') return;
    void api<PlanSummary>('/plan').then(setPlan, () => undefined);
  }, [me.role]);
  if (!plan) return null;
  const limit = plan.limits.completesPerMonth;
  const used = plan.usage.completesThisMonth;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="nx-plan" data-testid="sidebar-plan">
      <div className="nx-plan-title">
        <Sparkles size={15} aria-hidden="true" /> ZAPX {plan.plan.name}
      </div>
      <div className="small muted">
        {used.toLocaleString()} completes this month{limit ? ` of ${limit.toLocaleString()}` : ' (unlimited)'}
      </div>
      {limit ? (
        <div className="nx-meter" role="progressbar" aria-label="Completes this month" aria-valuenow={pct}>
          <div style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {me.role === 'ADMIN' ? (
        <Link href="/settings" className="nx-plan-link">
          Manage plan
        </Link>
      ) : null}
    </div>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** `forInterviewers`: the page is also for the interviewer role (the phone calling screen). */
export function Shell({ children, crumbs, forInterviewers }: { children: ReactNode; crumbs?: ReactNode; forInterviewers?: boolean }) {
  const me = useMe();
  const path = usePathname() ?? '/';
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => setNavOpen(false), [path]);
  const items = navFor(me);

  return (
    <div className={`nx-app${navOpen ? ' nav-open' : ''}`}>
      <aside className="nx-sidebar" aria-label="Main">
        <div className="nx-sidebar-head">
          <Link href="/" className="nx-logo" aria-label="ZAPX home">
            <span className="nx-logo-mark" aria-hidden="true">
              <Zap size={20} strokeWidth={2.6} />
            </span>
            <span className="nx-logo-text">
              <span className="nx-logo-word">ZAPX</span>
              <span className="nx-logo-sub">Survey programming &amp; QA by Sampledge</span>
            </span>
          </Link>
          <button className="nx-icon-btn nx-only-mobile" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="nx-nav">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item, path);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nx-nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="nx-sidebar-foot">
          {me ? <PlanCard me={me} /> : null}
          {me ? (
            <div className="nx-account">
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="nx-text-btn"
                  onClick={async () => {
                    await api('/auth/logout', { method: 'POST' });
                    window.location.href = '/login';
                  }}
                >
                  <LogOut size={14} aria-hidden="true" /> Sign out
                </button>
                <button
                  className="nx-text-btn"
                  title="Ends your sessions on every computer and phone"
                  data-testid="sign-out-everywhere"
                  onClick={async () => {
                    if (!window.confirm('Sign out on every device, including this one?')) return;
                    await api('/auth/logout-all', { method: 'POST' });
                    window.location.href = '/login';
                  }}
                >
                  Sign out everywhere
                </button>
                <Link href="/account" className="nx-text-btn" data-testid="my-account">
                  My account
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
      <div className="nx-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <div className="nx-main">
        <header className="topbar nx-topbar">
          <button className="nx-icon-btn nx-only-mobile" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          {me && me.role !== 'INTERVIEWER' ? <GlobalSearch /> : null}
          {crumbs ? <nav className="muted small nx-crumbs">{crumbs}</nav> : null}
          <div className="spacer" />
          {me && me.role !== 'INTERVIEWER' ? <NotificationBell /> : null}
          <ThemeMenu />
          {me ? (
            <div className="nx-user" title={`${me.name} · ${me.email}`}>
              <span className="nx-avatar" aria-hidden="true">
                {initials(me.name)}
              </span>
              <span className="nx-user-text">
                <strong>
                  {me.name} · {me.role.toLowerCase()}
                </strong>
                <span className="muted small">{me.tenant.name}</span>
              </span>
            </div>
          ) : null}
        </header>
        <main className="container nx-container">
          {me?.role === 'INTERVIEWER' && !forInterviewers ? (
            <section className="panel" data-testid="interviewer-notice">
              <h1>Use the interviewer app</h1>
              <p>
                Your account is for interviewing. For face-to-face interviews, sign in to the ZAPX interviewer (CAPI) app on your tablet or
                phone. For phone interviews, open <Link href="/calls">Calls</Link>.
              </p>
            </section>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { message?: string; body?: { issues?: Array<{ path: string; message: string }> } };
  return (
    <div className="error-text" role="alert">
      {e.message ?? String(error)}
      {e.body?.issues?.length ? (
        <ul>
          {e.body.issues.slice(0, 10).map((i, n) => (
            <li key={n}>
              <span className="mono">{i.path || '(root)'}</span>: {i.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="copy">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
    </div>
  );
}
