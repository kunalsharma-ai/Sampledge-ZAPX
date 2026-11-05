/** Shapes of the API answers the app reads (subset of the server types). */
export type SurveyStatus = 'DRAFT' | 'LIVE' | 'PAUSED' | 'CLOSED';

export interface DashboardSummary {
  generatedAt: string;
  projects: number;
  surveys: { total: number; byStatus: Record<SurveyStatus, number> };
  responses: {
    total: number;
    byStatus: Record<string, number>;
    byMode: { CAWI: number; CAPI: number; CATI: number };
    byDevice: { desktop: number; mobile: number; tablet: number; unknown: number };
    rejectedInReview: number;
    pendingReview: number;
    countries: number;
    topCountries: Array<{ code: string; count: number }>;
  };
  trend: Array<{ date: string; starts: number; completes: number }>;
  qa: { surveysTested: number; surveysPassing: number; runs: number };
  recentSurveys: Array<{
    id: string;
    name: string;
    status: SurveyStatus;
    projectId: string;
    projectName: string;
    updatedAt: string;
    responses: number;
    completes: number;
  }>;
}

export interface Project {
  id: string;
  name: string;
  client?: string | null;
  createdAt: string;
  _count?: { surveys: number; vendors: number };
}

export interface SurveyRow {
  id: string;
  name: string;
  status: SurveyStatus;
  updatedAt: string;
  liveVersionId?: string | null;
}

export interface ProjectDetail extends Project {
  surveys: SurveyRow[];
  vendors: Array<{ id: string; name: string; code: string; redirectMode: string; integration: string | null }>;
}

export interface SurveyDetail extends SurveyRow {
  projectId: string;
  versions: Array<{ id: string; version: number; status: string; createdAt: string; publishedAt: string | null }>;
  responseCounts: Record<string, number>;
}

export interface Quota {
  id: string;
  label: string;
  target: number;
  publishedTarget: number;
  overridden: boolean;
  count: number;
}

export interface ResponseRow {
  id: string;
  uid: string | null;
  country: string | null;
  device: string | null;
  status: string;
  mode: 'CAWI' | 'CAPI' | 'CATI';
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  qualityScore: number | null;
  reviewState: string;
  isTest: boolean;
  vendor: { code: string; name: string } | null;
  interviewer: { name: string } | null;
}

export interface Question {
  id: string;
  type: string;
  text: string;
  options?: Array<{ code: number; label: string }>;
  [k: string]: unknown;
}
export interface Definition {
  title: string;
  pages: Array<{ id: string; title?: string; questions: Question[]; [k: string]: unknown }>;
  [k: string]: unknown;
}
export interface DraftAnswer {
  version: { id: string; version: number; status: string; updatedAt: string; definition: Definition };
  check: { ok?: boolean; publishable?: boolean; errors?: unknown[]; issues?: Array<{ severity: string; message: string }> } & Record<
    string,
    unknown
  >;
}

export interface Job {
  id: string;
  type: string;
  status: string;
  progress: number | null;
  progressNote: string | null;
  result: { fileId?: string; name?: string; size?: number; rows?: number; format?: string; expiresAt?: string; passed?: boolean } | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface FrequencyRow {
  code: number | string;
  label: string;
  count: number;
  pct: number;
}
export interface Frequency {
  variable: { id: string; label: string; kind: string };
  base: number;
  rows: FrequencyRow[];
  stats: { mean?: number; median?: number } | null;
  samples?: string[];
  nps?: { score: number; promoters: number; passives: number; detractors: number; base: number };
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}
