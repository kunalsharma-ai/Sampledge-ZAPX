import type { ReactNode } from 'react';
import { Bot, Languages, ShieldCheck, Sparkles } from 'lucide-react';
import { BrandLogo, BrandMark, BrandWordmark } from '@/components/neon/Brand';
import { Robot } from '@/components/neon/Illustrations';

const POINTS = [
  { icon: Sparkles, label: 'AI survey architect' },
  { icon: ShieldCheck, label: 'QA lab & logic checks' },
  { icon: Languages, label: 'Multi-language' },
  { icon: Bot, label: 'Fieldwork & quality review' },
];

/**
 * Neon frame for the signed-out pages (sign in, forgot and reset password): brand story on the left,
 * the form card on the right. Purely visual; the form inside keeps its own behaviour.
 */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="nx-auth">
      <section className="nx-auth-story" aria-hidden="true">
        <BrandLogo width={320} />
        <p className="nx-auth-title">
          Build, program, test &amp; launch surveys <span className="nx-gradient-text">smarter with AI</span>
        </p>
        <div className="nx-auth-art">
          <Robot size={200} />
        </div>
        <ul className="nx-auth-points">
          {POINTS.map(({ icon: Icon, label }) => (
            <li key={label}>
              <Icon size={15} />
              {label}
            </li>
          ))}
        </ul>
      </section>
      <section className="nx-auth-form">{children}</section>
    </main>
  );
}

/** The SampCode wordmark shown at the top of each signed-out form card. */
export function AuthBrand() {
  return (
    <div className="nx-auth-brand">
      <BrandMark size={32} className="nx-logo-mark" />
      <BrandWordmark />
    </div>
  );
}
