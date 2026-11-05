import type { ReactNode } from 'react';
import './super-admin.css';

/** Super admin console: loads its own styles (on top of the shared neon/Quantum ones). */
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return children;
}
