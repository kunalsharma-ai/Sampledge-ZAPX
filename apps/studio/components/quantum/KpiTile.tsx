'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFullMotion } from '@/lib/theme/ThemeProvider';

export interface KpiTileProps {
  label: string;
  value: number;
  /** Formats the number (default: grouped integer). */
  format?: (n: number) => string;
  /** Change against a previous period, e.g. "+12% vs last week", with its tone. */
  delta?: { text: string; tone: 'good' | 'bad' | 'neutral' };
  icon?: ReactNode;
  /** Drill-down destination. */
  href?: string;
}

const grouped = (n: number) => Math.round(n).toLocaleString();

/** One headline number. Counts up when it first appears (only with full motion); screen readers get the final value. */
export function KpiTile({ label, value, format = grouped, delta, icon, href }: KpiTileProps) {
  const full = useFullMotion();
  const [shown, setShown] = useState(full ? 0 : value);
  const from = useRef(0);
  useEffect(() => {
    if (!full) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 700);
      const eased = 1 - (1 - p) ** 3;
      setShown(origin + (value - origin) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, full]);

  const body = (
    <>
      <span className="q-kpi-head">
        {icon ? (
          <span className="q-kpi-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span className="q-kpi-label">{label}</span>
      </span>
      <span className="q-kpi-value" aria-hidden="true">
        {format(shown)}
      </span>
      <span className="q-visually-hidden">{format(value)}</span>
      {delta ? <span className={`q-kpi-delta q-tone-${delta.tone}`}>{delta.text}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="q-kpi q-interactive">
      {body}
    </Link>
  ) : (
    <div className="q-kpi">{body}</div>
  );
}
