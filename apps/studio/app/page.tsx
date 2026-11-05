'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileUp,
  FlaskConical,
  Globe2,
  Languages,
  LayoutTemplate,
  Monitor,
  MousePointerClick,
  Palette,
  PhoneCall,
  Plus,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Tablet,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { PRESET_LIST, PRESETS } from '@zapx/quantum';
import { api } from '@/lib/api';
import { useMe } from '@/lib/useMe';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { ErrorNote, Shell } from '@/components/Shell';
import { ProjectsSection } from '@/components/neon/ProjectsSection';
import { CreateSurveyDialog, type StartMode } from '@/components/neon/CreateSurvey';
import { Donut, Funnel, ShareBars, TrendChart } from '@/components/neon/Charts';
import { Globe, Robot } from '@/components/neon/Illustrations';
import { LatestSurveyPreview } from '@/components/neon/LatestSurveyPreview';

type SurveyStatus = 'DRAFT' | 'LIVE' | 'PAUSED' | 'CLOSED';
interface Summary {
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

const fmt = (n: number) => n.toLocaleString();
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 100_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString();
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

function countryName(code: string) {
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Kpi({
  icon: Icon,
  tone,
  value,
  label,
  sub,
  testId,
}: {
  icon: LucideIcon;
  tone: number;
  value: string;
  label: string;
  sub: string;
  testId: string;
}) {
  return (
    <div className={`nx-kpi tone-${tone}`} data-testid={testId}>
      <span className="nx-kpi-icon" aria-hidden="true">
        <Icon size={22} />
      </span>
      <div>
        <div className="nx-kpi-value">{value}</div>
        <div className="nx-kpi-label">{label}</div>
        <div className="nx-kpi-sub">{sub}</div>
      </div>
    </div>
  );
}

const ORBIT: Array<[string, LucideIcon]> = [
  ['AI survey architect', Sparkles],
  ['Import questionnaires', FileUp],
  ['QA lab & logic checks', ShieldCheck],
  ['Multi-language', Languages],
  ['Themes & design', Palette],
  ['CAPI & CATI fieldwork', Users],
];

export default function DashboardPage() {
  const me = useMe();
  const { appearance, resolved, update } = useTheme();
  const [data, setData] = useState<Summary | null>(null);
  const [ai, setAi] = useState<{ configured: boolean; model?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [dialog, setDialog] = useState<StartMode | null>(null);
  const canEdit = !!me && me.role !== 'VIEWER';

  const load = useCallback(() => api<Summary>('/dashboard').then(setData, setError), []);
  useEffect(() => {
    void load();
    void api<{ configured: boolean; model?: string }>('/ai/status').then(setAi, () => undefined);
  }, [load]);
  const closeDialog = useCallback(() => setDialog(null), []);

  const latest = data?.recentSurveys[0] ?? null;
  const tabLink = (tab: string) => (latest ? `/surveys/${latest.id}?tab=${tab}` : null);

  const r = data?.responses;
  const finished = r ? r.total - (r.byStatus.IN_PROGRESS ?? 0) : 0;
  const completes = r?.byStatus.COMPLETE ?? 0;
  const last7 = useMemo(() => (data ? data.trend.slice(-7).reduce((n, d) => n + d.starts, 0) : 0), [data]);
  const scheme = resolved.scheme;

  const capabilities: Array<{ label: string; hint: string; icon: LucideIcon; href: string | null }> = [
    { label: 'Visual survey builder', hint: 'Pages, questions, media', icon: LayoutTemplate, href: tabLink('build') },
    { label: 'AI & file import', hint: 'Draft, convert, review', icon: Sparkles, href: tabLink('assist') },
    { label: 'Logic & validation', hint: 'Live logic check', icon: Workflow, href: tabLink('build') },
    { label: 'Themes & design', hint: 'Brand the respondent view', icon: Palette, href: tabLink('design') },
    { label: 'Translations', hint: 'AI drafts, human review', icon: Languages, href: tabLink('languages') },
    { label: 'Device preview', hint: 'Desktop, tablet, phone', icon: Smartphone, href: tabLink('preview') },
    { label: 'QA lab', hint: 'Synthetic respondents', icon: FlaskConical, href: tabLink('qa') },
    { label: 'Launch & links', hint: 'Vendors, redirects, status', icon: Rocket, href: tabLink('distribute') },
    { label: 'Quality & fraud', hint: 'Scores, review queue', icon: ShieldCheck, href: tabLink('quality') },
    { label: 'Face-to-face (CAPI)', hint: 'Offline interviewer app', icon: Users, href: tabLink('capi') },
    { label: 'Phone interviews', hint: 'Call lists and dialer', icon: PhoneCall, href: me?.role === 'VIEWER' ? null : '/calls' },
    { label: 'Analysis & exports', hint: 'Tables, weighting, Excel', icon: BarChart3, href: tabLink('analysis') },
  ];

  const copilot: Array<{ label: string; icon: LucideIcon; action: () => void; href?: string | null }> = [
    { label: 'Create a new survey', icon: Plus, action: () => setDialog('blank') },
    { label: 'Draft a survey with AI', icon: Sparkles, action: () => setDialog('ai') },
    { label: 'Import & convert a questionnaire', icon: FileUp, action: () => setDialog('import') },
    { label: 'Add or check logic', icon: Workflow, action: () => undefined, href: tabLink('build') },
    { label: 'Generate translations', icon: Languages, action: () => undefined, href: tabLink('languages') },
    { label: 'Run QA checks', icon: ClipboardCheck, action: () => undefined, href: tabLink('qa') },
    { label: 'Analyze survey results', icon: BarChart3, action: () => undefined, href: tabLink('analysis') },
  ];

  return (
    <Shell>
      <div className="nx-dash">
        <div className="nx-dash-main">
          {/* ---- Hero ---- */}
          <section className="nx-hero panel" aria-labelledby="hero-title">
            <div className="nx-hero-copy">
              <h1 id="hero-title" className="nx-hero-title">
                Build, program, test &amp; launch surveys <span className="nx-gradient-text">smarter with AI</span>
              </h1>
              <p className="nx-hero-sub">
                Survey programming, QA, security and fieldwork for market research in one platform
                {me ? (
                  <>
                    {' '}
                    for <strong>{me.tenant.name}</strong>
                  </>
                ) : null}
                .
              </p>
              {canEdit ? (
                <div className="row nx-hero-actions">
                  <button className="primary nx-cta" onClick={() => setDialog('blank')} data-testid="hero-create-survey">
                    <Plus size={18} aria-hidden="true" /> Create survey
                  </button>
                  <button className="nx-ghost" onClick={() => setDialog('import')}>
                    <FileUp size={16} aria-hidden="true" /> Import questionnaire
                  </button>
                  <button className="nx-ghost" onClick={() => setDialog('ai')}>
                    <Sparkles size={16} aria-hidden="true" /> Describe it to AI
                  </button>
                </div>
              ) : null}
              <dl className="nx-hero-stats">
                <div>
                  <Globe2 size={20} aria-hidden="true" />
                  <dt>Markets</dt>
                  <dd>{data ? fmt(r!.countries) : '–'}</dd>
                </div>
                <div>
                  <Users size={20} aria-hidden="true" />
                  <dt>Respondents</dt>
                  <dd>{data ? compact(r!.total) : '–'}</dd>
                </div>
                <div>
                  <Activity size={20} aria-hidden="true" />
                  <dt>Live surveys</dt>
                  <dd>{data ? fmt(data.surveys.byStatus.LIVE) : '–'}</dd>
                </div>
              </dl>
            </div>
            <div className="nx-hero-art" aria-hidden="true">
              <div className="nx-orbit">
                {ORBIT.map(([label, Icon], i) => (
                  <span key={label} className={`nx-orbit-chip c${i}`}>
                    <Icon size={16} />
                    {label}
                  </span>
                ))}
              </div>
              <Robot size={210} className="nx-hero-robot" />
            </div>
          </section>

          <ErrorNote error={error} />

          {/* ---- KPIs ---- */}
          <section className="nx-kpis" aria-label="Key numbers">
            <Kpi
              icon={LayoutTemplate}
              tone={0}
              testId="kpi-projects"
              value={data ? fmt(data.projects) : '–'}
              label="Projects"
              sub={data ? `${fmt(data.surveys.total)} surveys` : ' '}
            />
            <Kpi
              icon={Rocket}
              tone={1}
              testId="kpi-live"
              value={data ? fmt(data.surveys.byStatus.LIVE) : '–'}
              label="Live surveys"
              sub={data ? `${fmt(data.surveys.byStatus.DRAFT)} in programming · ${fmt(data.surveys.byStatus.PAUSED)} paused` : ' '}
            />
            <Kpi
              icon={Users}
              tone={2}
              testId="kpi-responses"
              value={data ? compact(r!.total) : '–'}
              label="Total responses"
              sub={data ? `${fmt(last7)} started in the last 7 days` : ' '}
            />
            <Kpi
              icon={CheckCircle2}
              tone={3}
              testId="kpi-completes"
              value={data ? compact(completes) : '–'}
              label="Completes"
              sub={data ? `${pct(completes, finished)} of finished interviews` : ' '}
            />
            <Kpi
              icon={ShieldCheck}
              tone={4}
              testId="kpi-qa"
              value={data ? (data.qa.surveysTested ? pct(data.qa.surveysPassing, data.qa.surveysTested) : '–') : '–'}
              label="QA pass rate"
              sub={
                data
                  ? data.qa.surveysTested
                    ? `${data.qa.surveysPassing} of ${data.qa.surveysTested} tested surveys pass`
                    : 'No QA runs yet'
                  : ' '
              }
            />
            <Kpi
              icon={Clock}
              tone={5}
              testId="kpi-review"
              value={data ? fmt(r!.pendingReview) : '–'}
              label="Awaiting review"
              sub="Completes held for a quality check"
            />
          </section>

          {/* ---- Journey ---- */}
          <section className="panel nx-card" aria-labelledby="journey-title">
            <h2 id="journey-title">Survey journey</h2>
            <ol className="nx-journey">
              {[
                { icon: Palette, label: 'Design & program', value: data?.surveys.byStatus.DRAFT, unit: 'in programming' },
                {
                  icon: FlaskConical,
                  label: 'Test & QA',
                  value: data?.qa.surveysTested,
                  unit: data ? `tested · ${data.qa.surveysPassing} passing` : 'tested',
                },
                { icon: Rocket, label: 'Deploy', value: data?.surveys.byStatus.LIVE, unit: 'live' },
                { icon: Users, label: 'Collect', value: r?.total, unit: 'responses' },
                { icon: ShieldCheck, label: 'Review', value: r?.pendingReview, unit: 'awaiting review' },
                { icon: BarChart3, label: 'Analyze', value: completes, unit: 'completes' },
              ].map((s, i) => (
                <li key={s.label} className={`tone-${i}`}>
                  <span className="nx-journey-icon" aria-hidden="true">
                    <s.icon size={22} />
                  </span>
                  <strong>{s.label}</strong>
                  <span className="small muted">
                    {data ? fmt(s.value ?? 0) : '–'} {s.unit}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* ---- Charts ---- */}
          <div className="nx-chart-grid">
            <section className="panel nx-card nx-span-2" aria-labelledby="trend-title">
              <div className="nx-card-head">
                <h2 id="trend-title">Survey performance</h2>
                <span className="small muted">Last 30 days · live data</span>
              </div>
              {data ? (
                <TrendChart
                  data={data.trend}
                  caption="Responses started and completed per day, last 30 days"
                  series={[
                    { key: 'starts', label: 'Started', color: 'var(--viz-2)' },
                    { key: 'completes', label: 'Completed', color: 'var(--viz-1)' },
                  ]}
                />
              ) : (
                <div className="nx-skeleton" style={{ height: 190 }} />
              )}
            </section>
            <section className="panel nx-card" aria-labelledby="funnel-title">
              <h2 id="funnel-title">Respondent journey</h2>
              {data && r!.total ? (
                <Funnel
                  stages={[
                    { label: 'Started', value: r!.total, hint: 'Every respondent who entered a survey' },
                    { label: 'Finished', value: finished, hint: 'Reached an outcome: complete, screened out, quota full or rejected' },
                    { label: 'Completed', value: completes, hint: 'Qualified completes' },
                    { label: 'Accepted', value: completes - r!.rejectedInReview, hint: 'Completes not rejected in quality review' },
                  ]}
                />
              ) : (
                <p className="muted small">{data ? 'No responses yet. Launch a survey to see the funnel.' : 'Loading…'}</p>
              )}
            </section>
            <section className="panel nx-card" aria-labelledby="status-title">
              <h2 id="status-title">Response overview</h2>
              {data && r!.total ? (
                <Donut
                  total={r!.total}
                  centerLabel="Responses"
                  caption="Responses by outcome"
                  slices={[
                    { key: 'complete', label: 'Complete', value: completes, color: 'var(--q-good)' },
                    { key: 'progress', label: 'In progress', value: r!.byStatus.IN_PROGRESS ?? 0, color: 'var(--viz-1)' },
                    {
                      key: 'screened',
                      label: 'Screened out / quota full',
                      value: (r!.byStatus.TERMINATE ?? 0) + (r!.byStatus.QUOTA_FULL ?? 0),
                      color: 'var(--viz-4)',
                    },
                    {
                      key: 'quality',
                      label: 'Quality & security',
                      value: (r!.byStatus.QUALITY_FAIL ?? 0) + (r!.byStatus.SECURITY_REJECT ?? 0) + (r!.byStatus.DUPLICATE ?? 0),
                      color: 'var(--q-bad)',
                    },
                    {
                      key: 'other',
                      label: 'Partial / error',
                      value: (r!.byStatus.PARTIAL ?? 0) + (r!.byStatus.TECHNICAL_ERROR ?? 0),
                      color: 'var(--viz-neutral)',
                    },
                  ]}
                />
              ) : (
                <p className="muted small">{data ? 'No responses yet.' : 'Loading…'}</p>
              )}
            </section>
            <section className="panel nx-card" aria-labelledby="device-title">
              <h2 id="device-title">Device distribution</h2>
              {data && r!.total ? (
                <>
                  <ul className="nx-devices">
                    {(
                      [
                        ['desktop', 'Desktop', Monitor],
                        ['mobile', 'Mobile', Smartphone],
                        ['tablet', 'Tablet', Tablet],
                      ] as const
                    ).map(([k, label, Icon], i) => (
                      <li key={k} className={`tone-${i}`} title={`${label}: ${fmt(r!.byDevice[k])}`}>
                        <span className="nx-device-bubble" aria-hidden="true">
                          <Icon size={22} />
                        </span>
                        <b>{pct(r!.byDevice[k], r!.total)}</b>
                        <span className="small muted">{label}</span>
                      </li>
                    ))}
                  </ul>
                  <h3 className="small muted nx-subhead">Interview mode</h3>
                  <ShareBars
                    total={r!.total}
                    color="var(--viz-2)"
                    rows={[
                      { key: 'cawi', label: 'Online', value: r!.byMode.CAWI },
                      { key: 'capi', label: 'Face to face', value: r!.byMode.CAPI },
                      { key: 'cati', label: 'Phone', value: r!.byMode.CATI },
                    ]}
                  />
                </>
              ) : (
                <p className="muted small">{data ? 'No responses yet.' : 'Loading…'}</p>
              )}
            </section>
            <section className="panel nx-card" aria-labelledby="reach-title">
              <h2 id="reach-title">Global reach</h2>
              <div className="nx-reach">
                <div className="nx-reach-globe">
                  <Globe size={150} />
                  <div className="nx-reach-count">
                    <b>{data ? fmt(r!.countries) : '–'}</b>
                    <span>{r?.countries === 1 ? 'market' : 'markets'}</span>
                  </div>
                </div>
                {data && r!.topCountries.length ? (
                  <ShareBars
                    total={r!.total}
                    color="var(--viz-3)"
                    rows={r!.topCountries.map((c) => ({ key: c.code, label: countryName(c.code), value: c.count }))}
                  />
                ) : (
                  <p className="muted small">{data ? 'Respondent countries appear here once responses arrive.' : ''}</p>
                )}
              </div>
            </section>
          </div>

          {/* ---- Capabilities ---- */}
          <section className="panel nx-card" aria-labelledby="cap-title">
            <div className="nx-card-head">
              <h2 id="cap-title">Create, program, test &amp; launch</h2>
              <span className="small muted">
                {latest ? <>Opens in your latest survey: {latest.name}</> : 'Create a survey to open these tools'}
              </span>
            </div>
            <div className="nx-caps">
              {capabilities.map((c, i) => {
                const body = (
                  <>
                    <span className={`nx-cap-icon tone-${i % 6}`} aria-hidden="true">
                      <c.icon size={22} />
                    </span>
                    <strong>{c.label}</strong>
                    <span className="small muted">{c.hint}</span>
                  </>
                );
                return c.href ? (
                  <Link key={c.label} href={c.href} className="nx-cap">
                    {body}
                  </Link>
                ) : (
                  <div key={c.label} className="nx-cap disabled" aria-disabled="true">
                    {body}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ---- Recent surveys ---- */}
          <section className="panel nx-card" aria-labelledby="recent-title">
            <div className="nx-card-head">
              <h2 id="recent-title">Recent surveys</h2>
            </div>
            {!data ? (
              <p className="muted">Loading…</p>
            ) : data.recentSurveys.length === 0 ? (
              <p className="muted">No surveys yet.</p>
            ) : (
              <div className="scroll-x">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Survey</th>
                      <th>Project</th>
                      <th>Status</th>
                      <th className="num">Responses</th>
                      <th>Completion</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentSurveys.map((s) => {
                      const rate = s.responses ? Math.round((s.completes / s.responses) * 100) : 0;
                      return (
                        <tr key={s.id}>
                          <td>
                            <Link href={`/surveys/${s.id}`}>{s.name}</Link>
                          </td>
                          <td className="muted">{s.projectName}</td>
                          <td>
                            <span className={`badge ${s.status.toLowerCase()}`}>{s.status.toLowerCase()}</span>
                          </td>
                          <td className="num">{fmt(s.responses)}</td>
                          <td>
                            <div className="nx-progress" title={`${fmt(s.completes)} completes of ${fmt(s.responses)} responses`}>
                              <span className="nx-meter">
                                <span style={{ width: `${rate}%` }} />
                              </span>
                              <span className="small">{s.responses ? `${rate}%` : '–'}</span>
                            </div>
                          </td>
                          <td className="muted small">{new Date(s.updatedAt).toLocaleDateString()}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <ProjectsSection limit={8} heading="Projects" onCreated={load} />
        </div>

        {/* ---- Right rail ---- */}
        <aside className="nx-rail" aria-label="Assistant and preview">
          <section className="panel nx-card nx-copilot" aria-labelledby="copilot-title">
            <div className="nx-copilot-head">
              <Robot size={74} platform={false} />
              <div>
                <h2 id="copilot-title">
                  ZAPX AI Copilot <Sparkles size={16} aria-hidden="true" className="nx-sparkle" />
                </h2>
                <p className="small muted" data-testid="ai-status">
                  {ai === null
                    ? 'Checking AI…'
                    : ai.configured
                      ? `Connected${ai.model ? ` · ${ai.model}` : ''}`
                      : 'AI is not configured yet. File import still works.'}
                </p>
              </div>
            </div>
            <ul className="nx-copilot-list">
              {copilot.map((c) => {
                const inner = (
                  <>
                    <c.icon size={16} aria-hidden="true" />
                    <span>{c.label}</span>
                    <ArrowRight size={14} aria-hidden="true" className="nx-copilot-arrow" />
                  </>
                );
                if (c.href !== undefined)
                  return (
                    <li key={c.label}>
                      {c.href ? (
                        <Link href={c.href} className="nx-copilot-item">
                          {inner}
                        </Link>
                      ) : (
                        <span className="nx-copilot-item disabled" title="Create a survey first">
                          {inner}
                        </span>
                      )}
                    </li>
                  );
                return (
                  <li key={c.label}>
                    <button className="nx-copilot-item" onClick={c.action} disabled={!canEdit}>
                      {inner}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <LatestSurveyPreview survey={latest} />

          <section className="panel nx-card" aria-labelledby="look-title">
            <div className="nx-card-head">
              <h2 id="look-title">Choose your look</h2>
              <Link href="/appearance" className="small">
                More options
              </Link>
            </div>
            <div className="nx-swatches" role="radiogroup" aria-label="Theme">
              {PRESET_LIST.map((p) => {
                const seed = p[scheme];
                const accent = seed.accent ?? p.accents[0];
                return (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={appearance.preset === p.id}
                    aria-label={p.name}
                    title={p.name}
                    className="nx-swatch"
                    onClick={() => update({ preset: p.id })}
                    style={{
                      background: `radial-gradient(circle at 25% 25%, ${p.accents[2]} 0, transparent 45%), radial-gradient(circle at 80% 70%, ${p.accents[1]} 0, transparent 55%), linear-gradient(135deg, ${accent}, ${seed.bg})`,
                    }}
                  />
                );
              })}
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              {PRESETS[appearance.preset].name} · {scheme} · saved to your account
            </p>
          </section>
          <p className="small muted nx-generated">
            <MousePointerClick size={13} aria-hidden="true" /> Numbers exclude test responses. Updated{' '}
            {data ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…'}.
          </p>
        </aside>
      </div>
      <CreateSurveyDialog open={dialog !== null} mode={dialog ?? 'blank'} onClose={closeDialog} />
    </Shell>
  );
}
