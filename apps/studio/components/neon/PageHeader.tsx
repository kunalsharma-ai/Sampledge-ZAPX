import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The neon page header used on every signed-in page: a glowing icon tile, an optional eyebrow line,
 * the page title (the page's only h1), a description and actions on the right. Visual only.
 */
export function PageHeader({
  icon: Icon,
  tone = 0,
  eyebrow,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  /** Colour of the icon tile, the same six tones as the dashboard KPI cards. */
  tone?: 0 | 1 | 2 | 3 | 4 | 5;
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Description and status line under the title. */
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="nx-head">
      <span className={`nx-head-icon tone-${tone}`} aria-hidden="true">
        <Icon size={22} />
      </span>
      <div className="nx-head-text">
        {eyebrow ? <div className="nx-head-eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {children ? <div className="nx-head-desc">{children}</div> : null}
      </div>
      {actions ? <div className="nx-head-actions">{actions}</div> : null}
    </header>
  );
}
