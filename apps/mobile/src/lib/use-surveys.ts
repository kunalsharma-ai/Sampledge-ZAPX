import { useCallback, useEffect, useState } from 'react';
import { useSession } from './session';
import type { Project, ProjectDetail, SurveyRow } from './types';

export interface SurveyPick extends SurveyRow {
  projectId: string;
  projectName: string;
}

/** Every survey the member can see, across projects (newest activity first). */
export function useAllSurveys(enabled = true) {
  const { api } = useSession();
  const [data, setData] = useState<SurveyPick[] | undefined>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const projects = await api.get<Project[]>('/projects');
      const details = await Promise.all(projects.slice(0, 50).map((p) => api.get<ProjectDetail>(`/projects/${p.id}`).catch(() => null)));
      const all = details.flatMap((d) => (d ? d.surveys.map((s) => ({ ...s, projectId: d.id, projectName: d.name })) : []));
      all.sort((a, b) => (a.status === 'LIVE' ? -1 : 0) - (b.status === 'LIVE' ? -1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
      setData(all);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, [api, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, error, loading, reload: load };
}
