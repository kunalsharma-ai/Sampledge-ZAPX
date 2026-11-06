/** Compare dotted versions numerically ("1.10.0" > "1.9.3"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Why this app may not sign in to that server, or null when it may. */
export function versionProblem(appVersion: string, server: { service?: unknown; minimumAppVersion?: unknown } | null): string | null {
  if (!server || server.service !== 'zapx') return 'This address is not a SampCode server. Check it with your administrator.';
  const min = typeof server.minimumAppVersion === 'string' ? server.minimumAppVersion : null;
  if (min && compareVersions(appVersion, min) < 0)
    return `This version of the app (${appVersion}) is too old for your SampCode server. Update SampCode from the App Store or Google Play.`;
  return null;
}
