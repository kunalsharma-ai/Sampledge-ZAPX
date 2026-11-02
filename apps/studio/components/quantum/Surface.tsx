import type { HTMLAttributes } from 'react';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** glass: translucent (follows the glass setting); solid: opaque; raised: solid with a stronger shadow. */
  variant?: 'glass' | 'solid' | 'raised';
  /** Interactive surfaces lift slightly on hover. */
  interactive?: boolean;
}

export function Surface({ variant = 'glass', interactive, className, ...rest }: SurfaceProps) {
  return (
    <div className={`q-surface q-surface-${variant}${interactive ? ' q-interactive' : ''}${className ? ` ${className}` : ''}`} {...rest} />
  );
}
