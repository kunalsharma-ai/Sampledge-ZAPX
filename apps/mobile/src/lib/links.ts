import type { Href } from 'expo-router';

/** Links in notifications point at studio pages; open the matching mobile screen where one exists. */
export function mobileHref(link: string | null): Href | null {
  if (!link) return null;
  const s = link.match(/\/surveys\/([^/?#]+)/);
  if (s) return `/survey/${s[1]}`;
  const p = link.match(/\/projects\/([^/?#]+)/);
  if (p) return `/project/${p[1]}`;
  if (link.startsWith('/automation')) return '/automation';
  return null;
}
