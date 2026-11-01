import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'ZAPX Studio', description: 'SAMPLEDGE ZAPX survey programming studio' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
