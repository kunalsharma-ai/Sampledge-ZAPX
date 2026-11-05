'use client';
/**
 * Dashboard charts, drawn as inline SVG/HTML so they follow the active Quantum theme. Series colours
 * come from --viz-1..4 (validated for colour-blind separation on both schemes); text uses text tokens.
 * Every chart has a hover read-out and a visually hidden table for screen readers.
 */
import { useId, useMemo, useState } from 'react';

const fmt = (n: number) => n.toLocaleString();
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();

export interface Series {
  key: string;
  label: string;
  color: string;
}

/** Daily activity: one area+line per series, shared y axis from zero, crosshair tooltip. */
export function TrendChart({
  data,
  series,
  height = 190,
  caption,
}: {
  data: Array<{ date: string } & Record<string, number | string>>;
  series: Series[];
  height?: number;
  caption: string;
}) {
  const id = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = height;
  const pad = { l: 36, r: 10, t: 10, b: 24 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  // A round top value that splits into four round steps (e.g. 0, 25, 50, 75, 100).
  const nice = (() => {
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
    return Math.max(4, Math.ceil(step) * 4);
  })();
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v: number) => pad.t + (1 - v / nice) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nice * f));
  const labelEvery = Math.ceil(data.length / 6);
  const shortDate = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = data.map((d, i) => [x(i), y(Number(d[s.key]) || 0)] as const);
        const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
        const area = `${line}L${x(data.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
        return { s, line, area };
      }),
    // x/y depend only on data, nice and size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, series, nice, H],
  );

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - pad.l - pad.r);
    setHover(Math.max(0, Math.min(data.length - 1, Math.round((px / (W - pad.l - pad.r)) * (data.length - 1)))));
  };
  const hv = hover !== null ? data[hover] : null;

  return (
    <figure className="nx-chart" style={{ margin: 0 }}>
      <div className="nx-legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label={caption}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`${id}${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={s.color} stopOpacity="0.35" />
                <stop offset="1" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="nx-grid" />
              <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="nx-axis">
                {compact(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text
                key={d.date}
                x={x(i)}
                y={H - 6}
                textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                className="nx-axis"
              >
                {shortDate(d.date)}
              </text>
            ) : null,
          )}
          {paths.map(({ s, area, line }) => (
            <g key={s.key}>
              <path d={area} fill={`url(#${id}${s.key})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          ))}
          {hover !== null ? (
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="nx-crosshair" vectorEffect="non-scaling-stroke" />
          ) : null}
          <rect
            x={pad.l}
            y={pad.t}
            width={W - pad.l - pad.r}
            height={H - pad.t - pad.b}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hv && hover !== null ? (
          <div className="nx-tooltip" style={{ left: `${(x(hover) / W) * 100}%`, top: 4 }}>
            <strong>{shortDate(hv.date)}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} />
                {s.label} <b>{fmt(Number(hv[s.key]) || 0)}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th>Date</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              {series.map((s) => (
                <td key={s.key}>{Number(d[s.key]) || 0}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Part-to-whole ring with the total in the middle and a labelled legend (value and share). */
export function Donut({ slices, total, centerLabel, caption }: { slices: Slice[]; total: number; centerLabel: string; caption: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const r = 52;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 2.5 : 0;
  let offset = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const len = (s.value / Math.max(1, total)) * c;
      const arc = { s, dash: `${Math.max(0, len - gap)} ${c}`, offset: -offset };
      offset += len;
      return arc;
    });
  const shown = slices.find((s) => s.key === hover);
  return (
    <div className="nx-donut">
      <svg viewBox="0 0 140 140" width="148" height="148" role="img" aria-label={caption}>
        <circle cx="70" cy="70" r={r} fill="none" className="nx-donut-track" strokeWidth="16" />
        {arcs.map(({ s, dash, offset: o }) => (
          <circle
            key={s.key}
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={hover === s.key ? 19 : 16}
            strokeDasharray={dash}
            strokeDashoffset={o}
            transform="rotate(-90 70 70)"
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
          >
            <title>{`${s.label}: ${fmt(s.value)}`}</title>
          </circle>
        ))}
        <text x="70" y="68" textAnchor="middle" className="nx-donut-value">
          {shown ? compact(shown.value) : compact(total)}
        </text>
        <text x="70" y="86" textAnchor="middle" className="nx-axis">
          {shown ? shown.label : centerLabel}
        </text>
      </svg>
      <ul className="nx-donut-legend">
        {slices.map((s) => (
          <li
            key={s.key}
            onPointerEnter={() => setHover(s.key)}
            onPointerLeave={() => setHover(null)}
            className={hover === s.key ? 'active' : ''}
          >
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
            <b>{total ? `${Math.round((s.value / total) * 100)}%` : '–'}</b>
            <span className="muted small">{fmt(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Respondent journey: each stage as a share of the first, narrowing bars with counts and percentages. */
export function Funnel({ stages }: { stages: Array<{ label: string; value: number; hint: string }> }) {
  const top = Math.max(1, stages[0]?.value ?? 1);
  return (
    <ol className="nx-funnel">
      {stages.map((s, i) => {
        const pct = (s.value / top) * 100;
        return (
          <li key={s.label} title={s.hint}>
            <div className="nx-funnel-bar" style={{ width: `${Math.max(34, 100 - i * 14)}%`, ['--i' as string]: i }}>
              <span>{s.label}</span>
              <b>
                {fmt(s.value)}
                {i > 0 ? <em> ({stages[0]!.value ? Math.round(pct) : 0}%)</em> : null}
              </b>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal share bars (countries, devices, modes). */
export function ShareBars({
  rows,
  total,
  color = 'var(--viz-1)',
}: {
  rows: Array<{ key: string; label: string; value: number }>;
  total: number;
  color?: string;
}) {
  return (
    <ul className="nx-sharebars">
      {rows.map((r) => {
        const pct = total ? (r.value / total) * 100 : 0;
        return (
          <li key={r.key} title={`${r.label}: ${fmt(r.value)}`}>
            <span className="nx-sharebars-label">{r.label}</span>
            <span className="nx-sharebars-track">
              <span style={{ width: `${pct}%`, background: color }} />
            </span>
            <b>{total ? `${pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%` : '–'}</b>
          </li>
        );
      })}
    </ul>
  );
}
