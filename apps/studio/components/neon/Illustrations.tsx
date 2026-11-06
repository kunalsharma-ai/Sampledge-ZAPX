/**
 * Decorative neon illustrations for the dashboard (pure SVG, theme-coloured through CSS variables).
 * They carry no data and are hidden from assistive technology.
 */
import { useId } from 'react';

/** The SampCode AI assistant: a friendly robot standing on a glowing platform. */
export function Robot({ size = 220, platform = true, className }: { size?: number; platform?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  const h = platform ? size * 1.08 : size * 0.92;
  return (
    <svg className={className} width={size} height={h} viewBox={`0 0 200 ${platform ? 216 : 184}`} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9c4ee" />
        </linearGradient>
        <linearGradient id={`${id}visor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1446" />
          <stop offset="1" stopColor="#07051a" />
        </linearGradient>
        <radialGradient id={`${id}eye`}>
          <stop offset="0" stopColor="#e0fbff" />
          <stop offset="0.45" stopColor="#5eead4" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}glow`}>
          <stop offset="0" stopColor="var(--q-accent-3, #22d3ee)" stopOpacity="0.85" />
          <stop offset="1" stopColor="var(--q-accent-2, #e046f0)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}ring`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--q-accent-3, #22d3ee)" />
          <stop offset="0.5" stopColor="var(--q-accent, #7c5cff)" />
          <stop offset="1" stopColor="var(--q-accent-2, #e046f0)" />
        </linearGradient>
      </defs>
      {platform ? (
        <g className="nx-platform">
          <ellipse cx="100" cy="196" rx="86" ry="16" fill={`url(#${id}glow)`} opacity="0.7" />
          <ellipse cx="100" cy="194" rx="70" ry="12" fill="none" stroke={`url(#${id}ring)`} strokeWidth="3" />
          <ellipse cx="100" cy="200" rx="84" ry="15" fill="none" stroke={`url(#${id}ring)`} strokeWidth="1.5" opacity="0.6" />
          <ellipse cx="100" cy="190" rx="52" ry="8" fill="var(--q-accent, #7c5cff)" opacity="0.35" />
        </g>
      ) : null}
      <g className="nx-robot-body">
        {/* antenna */}
        <line x1="100" y1="22" x2="100" y2="8" stroke="#c9c4ee" strokeWidth="3" strokeLinecap="round" />
        <circle cx="100" cy="7" r="5" fill="var(--q-accent-3, #22d3ee)" className="nx-blink" />
        {/* ears */}
        <rect x="26" y="52" width="18" height="40" rx="9" fill="var(--q-accent, #7c5cff)" />
        <rect x="156" y="52" width="18" height="40" rx="9" fill="var(--q-accent, #7c5cff)" />
        <circle cx="35" cy="72" r="5" fill="var(--q-accent-3, #22d3ee)" />
        <circle cx="165" cy="72" r="5" fill="var(--q-accent-3, #22d3ee)" />
        {/* head */}
        <rect x="38" y="22" width="124" height="100" rx="44" fill={`url(#${id}shell)`} />
        <rect x="52" y="40" width="96" height="64" rx="30" fill={`url(#${id}visor)`} />
        <ellipse cx="80" cy="70" rx="15" ry="15" fill={`url(#${id}eye)`} />
        <ellipse cx="120" cy="70" rx="15" ry="15" fill={`url(#${id}eye)`} />
        <ellipse cx="80" cy="70" rx="7" ry="8" fill="#cffafe" className="nx-eye" />
        <ellipse cx="120" cy="70" rx="7" ry="8" fill="#cffafe" className="nx-eye" />
        <path d="M88 90 Q100 98 112 90" stroke="#5eead4" strokeWidth="3" fill="none" strokeLinecap="round" />
        <ellipse cx="70" cy="34" rx="18" ry="5" fill="#ffffff" opacity="0.7" />
        {/* body */}
        <path d="M62 128 Q100 118 138 128 L132 172 Q100 182 68 172 Z" fill={`url(#${id}shell)`} />
        <circle cx="100" cy="150" r="15" fill={`url(#${id}visor)`} />
        <path d="M103 139 L94 152 L101 152 L97 162 L107 148 L100 148 Z" fill="var(--q-accent-3, #22d3ee)" />
        {/* arms */}
        <rect x="44" y="128" width="16" height="38" rx="8" fill="#d9d5f5" transform="rotate(14 52 128)" />
        <rect x="140" y="128" width="16" height="38" rx="8" fill="#d9d5f5" transform="rotate(-14 148 128)" />
      </g>
    </svg>
  );
}

/** A glowing wireframe globe with orbit ring, used beside the respondent-country list. */
export function Globe({ size = 150 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  const meridians = [-60, -30, 0, 30, 60];
  const parallels = [-50, -25, 0, 25, 50];
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true" focusable="false" className="nx-globe">
      <defs>
        <radialGradient id={`${id}g`} cx="0.38" cy="0.35" r="0.75">
          <stop offset="0" stopColor="var(--q-accent-3, #22d3ee)" stopOpacity="0.55" />
          <stop offset="0.55" stopColor="var(--q-accent, #7c5cff)" stopOpacity="0.45" />
          <stop offset="1" stopColor="var(--q-accent-2, #e046f0)" stopOpacity="0.25" />
        </radialGradient>
      </defs>
      <circle cx="80" cy="80" r="62" fill={`url(#${id}g)`} />
      <g fill="none" stroke="var(--q-accent-3, #22d3ee)" strokeOpacity="0.55" strokeWidth="0.9">
        <circle cx="80" cy="80" r="62" />
        {meridians.map((m) => (
          <ellipse key={m} cx="80" cy="80" rx={Math.abs(Math.cos((m * Math.PI) / 180)) * 62} ry="62" />
        ))}
        {parallels.map((p) => {
          const y = 80 + Math.sin((p * Math.PI) / 180) * 62;
          const r = Math.cos((p * Math.PI) / 180) * 62;
          return <ellipse key={p} cx="80" cy={y} rx={r} ry={r * 0.18} />;
        })}
      </g>
      <ellipse
        cx="80"
        cy="80"
        rx="76"
        ry="20"
        fill="none"
        stroke="var(--q-accent-2, #e046f0)"
        strokeWidth="1.6"
        strokeOpacity="0.8"
        transform="rotate(-18 80 80)"
      />
      <circle cx="146" cy="58" r="3.5" fill="var(--q-accent-2, #e046f0)" className="nx-blink" />
    </svg>
  );
}
