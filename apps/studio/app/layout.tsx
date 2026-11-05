import type { ReactNode } from 'react';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { DEFAULT_APPEARANCE, THEME_BOOT_SCRIPT, resolveTheme } from '@zapx/quantum';
import { ConfirmProvider } from '@/components/neon/ConfirmDialog';
import { ThemeProvider } from '@/lib/theme/ThemeProvider';
import './globals.css';
import './quantum.css';
import './neon.css';
import './neon-pages.css';

export const metadata = { title: 'ZAPX Studio', description: 'SAMPLEDGE ZAPX survey programming studio' };

const declarations = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `${k}:${v};`)
    .join('');

// The default theme, rendered on the server so every page is styled before (and without) scripts.
const light = resolveTheme(DEFAULT_APPEARANCE, { prefersDark: false, prefersReducedMotion: false });
const dark = resolveTheme(DEFAULT_APPEARANCE, { prefersDark: true, prefersReducedMotion: false });
const reduced = resolveTheme(DEFAULT_APPEARANCE, { prefersDark: false, prefersReducedMotion: true });
const motionVars = (t: typeof light) =>
  Object.fromEntries(Object.entries(t.vars).filter(([k]) => k.startsWith('--q-dur') || k === '--q-move'));
const DEFAULT_THEME_CSS =
  `:root{${declarations(light.vars)}color-scheme:light;}` +
  `@media (prefers-color-scheme: dark){:root{${declarations(dark.vars)}color-scheme:dark;}}` +
  `@media (prefers-reduced-motion: reduce){:root{${declarations(motionVars(reduced))}}}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The head script sets the saved theme on <html> before hydration, hence suppressHydrationWarning.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <style id="q-default-theme" dangerouslySetInnerHTML={{ __html: DEFAULT_THEME_CSS }} />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
