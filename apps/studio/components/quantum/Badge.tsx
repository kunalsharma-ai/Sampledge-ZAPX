import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

/** Status label. `pulse` marks something live (the dot holds still when motion is reduced). */
export function Badge({ tone = 'neutral', pulse, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <span className={`q-badge q-tone-${tone}`}>
      {pulse ? <span className="q-pulse" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
