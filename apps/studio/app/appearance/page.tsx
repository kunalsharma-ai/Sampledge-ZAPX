'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Accessibility,
  Building2,
  Check,
  CloudOff,
  LayoutGrid,
  List,
  Loader2,
  Palette,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import {
  PRESET_LIST,
  PRESETS,
  contrastReport,
  resolveTheme,
  type Appearance,
  type Density,
  type MotionLevel,
  type ThemeMode,
} from '@zapx/quantum';
import { Shell } from '@/components/Shell';
import { Badge, Button, ColorField, SegmentedControl, SelectionCards, Slider, Surface, Switch } from '@/components/quantum';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { useMe } from '@/lib/useMe';
import { ComponentPreview } from './ComponentPreview';

/** Miniature of a preset in the active scheme: page, light, a panel, a primary action and text. */
function Swatch({ appearance }: { appearance: Appearance }) {
  const t = resolveTheme(appearance, { prefersDark: appearance.mode === 'dark', prefersReducedMotion: true });
  const v = t.vars;
  return (
    <span className="q-swatch" style={{ background: v['--q-bg'] }}>
      <i
        style={{
          inset: 0,
          background: `radial-gradient(80% 90% at 0% 0%, ${v['--q-mesh-1']}, transparent), radial-gradient(70% 90% at 100% 0%, ${v['--q-mesh-2']}, transparent)`,
        }}
      />
      <i
        style={{
          left: '10%',
          top: '22%',
          width: '62%',
          height: '56%',
          borderRadius: 6,
          background: v['--q-surface'],
          border: `1px solid ${v['--q-border']}`,
        }}
      />
      <i style={{ left: '16%', top: '34%', width: '34%', height: 5, borderRadius: 3, background: v['--q-text'] }} />
      <i style={{ left: '16%', top: '48%', width: '24%', height: 4, borderRadius: 3, background: v['--q-text-muted'] }} />
      <i style={{ left: '16%', top: '60%', width: '22%', height: 9, borderRadius: 4, background: v['--q-gradient'] }} />
      <i style={{ right: '8%', top: '22%', width: '14%', height: '56%', borderRadius: 6, background: v['--q-accent-soft'] }} />
    </span>
  );
}

function SaveState() {
  const { saveState, source } = useTheme();
  if (saveState === 'saving')
    return (
      <span className="q-save-state muted small" role="status">
        <Loader2 size={14} aria-hidden /> Saving…
      </span>
    );
  if (saveState === 'error')
    return (
      <span className="q-save-state error-text small" role="status">
        <TriangleAlert size={14} aria-hidden /> Could not save to your account. It still applies on this device.
      </span>
    );
  if (saveState === 'local')
    return (
      <span className="q-save-state muted small" role="status">
        <CloudOff size={14} aria-hidden /> Saved on this device only
      </span>
    );
  return (
    <span className="q-save-state muted small" role="status" data-testid="appearance-source">
      <Check size={14} aria-hidden />
      {source === 'personal'
        ? 'Your own appearance, saved to your account'
        : source === 'organization'
          ? 'Using your organization’s default'
          : 'Using the ZAPX default'}
    </span>
  );
}

export default function AppearancePage() {
  const me = useMe();
  const { appearance, resolved, update, organizationDefault, source, resetToOrganization, setOrganizationDefault } = useTheme();
  const [layout, setLayout] = useState<'cards' | 'list'>('cards');
  const [orgMessage, setOrgMessage] = useState<string | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const report = useMemo(() => contrastReport(resolved, appearance.highContrast), [resolved, appearance.highContrast]);
  const scheme = resolved.scheme;
  const preset = PRESETS[appearance.preset];
  const isAdmin = me?.role === 'ADMIN';

  const orgAction = async (a: Appearance | null) => {
    setOrgBusy(true);
    setOrgMessage(null);
    try {
      await setOrganizationDefault(a);
      setOrgMessage(
        a ? `${PRESETS[a.preset].name} is now the default for members who have not chosen their own.` : 'Organization default cleared.',
      );
    } catch (e) {
      setOrgMessage((e as Error).message);
    } finally {
      setOrgBusy(false);
    }
  };

  return (
    <Shell crumbs={<Link href="/">Dashboard</Link>} forInterviewers>
      <div className="q-page-head">
        <div>
          <div className="q-eyebrow">Quantum Design System</div>
          <h1>Appearance</h1>
          <p className="muted" style={{ margin: 0 }}>
            Changes apply at once and follow you to every device you sign in on.
          </p>
        </div>
        <SaveState />
      </div>

      <div className="q-appearance">
        <div className="stack" style={{ gap: 16 }}>
          <Surface>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 className="q-section-title" style={{ margin: 0 }}>
                <Palette size={18} aria-hidden /> Theme
              </h2>
              <SegmentedControl
                label="Theme list layout"
                size="sm"
                value={layout}
                onChange={setLayout}
                options={[
                  { value: 'cards', label: <LayoutGrid size={14} />, ariaLabel: 'Cards' },
                  { value: 'list', label: <List size={14} />, ariaLabel: 'List' },
                ]}
              />
            </div>
            <SelectionCards
              label="Theme"
              layout={layout}
              value={appearance.preset}
              onChange={(preset) => update({ preset })}
              minWidth={150}
              data-testid="theme-presets"
              options={PRESET_LIST.map((p) => ({
                value: p.id,
                label: p.name,
                description: p.description,
                visual: (
                  <Swatch
                    appearance={{ ...appearance, preset: p.id, mode: scheme, accent: p.usesCustomAccent ? appearance.accent : null }}
                  />
                ),
              }))}
            />
          </Surface>

          <Surface>
            <h2 className="q-section-title">
              <SlidersHorizontal size={18} aria-hidden /> Mode, density and motion
            </h2>
            <div className="q-settings-grid">
              <div className="q-setting">
                <span className="q-setting-label">Colour mode</span>
                <SegmentedControl<ThemeMode>
                  label="Colour mode"
                  value={appearance.mode}
                  onChange={(mode) => update({ mode })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                  ]}
                />
              </div>
              <div className="q-setting">
                <span className="q-setting-label">Density</span>
                <SegmentedControl<Density>
                  label="Density"
                  value={appearance.density}
                  onChange={(density) => update({ density })}
                  options={[
                    { value: 'compact', label: 'Compact' },
                    { value: 'comfortable', label: 'Comfortable' },
                    { value: 'spacious', label: 'Spacious' },
                  ]}
                />
              </div>
              <div className="q-setting">
                <span className="q-setting-label">Animation</span>
                <SegmentedControl<MotionLevel>
                  label="Animation"
                  value={appearance.motion}
                  onChange={(motion) => update({ motion })}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'full', label: 'Full' },
                    { value: 'subtle', label: 'Subtle' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
                <span className="muted small">
                  {appearance.motion === 'system'
                    ? `Follows your device: ${resolved.attrs['data-q-motion'] === 'full' ? 'full motion' : 'reduced motion'} right now.`
                    : appearance.motion === 'subtle'
                      ? 'Fades only, nothing slides or scales.'
                      : appearance.motion === 'off'
                        ? 'No animation at all.'
                        : 'Short transitions (120–320 ms). Typing and saving never wait for them.'}
                </span>
              </div>
            </div>
          </Surface>

          <Surface>
            <h2 className="q-section-title">
              <Sparkles size={18} aria-hidden /> Colour and light
            </h2>
            <div className="q-settings-grid">
              <div className="q-setting">
                <ColorField
                  label={preset.usesCustomAccent ? 'Accent colour (drives this theme)' : 'Accent colour'}
                  value={
                    appearance.accent ??
                    (scheme === 'dark' ? (preset.dark.accent ?? preset.accents[0]) : (preset.light.accent ?? preset.accents[0]))
                  }
                  onChange={(accent) => update({ accent })}
                  data-testid="accent-hex"
                />
                {appearance.accent ? (
                  <Button size="sm" variant="ghost" onClick={() => update({ accent: null })}>
                    Use the theme’s own accent
                  </Button>
                ) : (
                  <span className="muted small">Pick any colour; ZAPX adjusts it where needed so text stays readable.</span>
                )}
              </div>
              <Slider
                label="Background light"
                value={appearance.background}
                onChange={(background) => update({ background })}
                data-testid="bg-intensity"
              />
              <Slider label="Glass effect" value={appearance.glass} onChange={(glass) => update({ glass })} hint="0% gives solid panels." />
              <Slider
                label="Gradient"
                value={appearance.gradient}
                onChange={(gradient) => update({ gradient })}
                hint="Blend of primary actions into the second accent."
              />
            </div>
          </Surface>

          <Surface>
            <h2 className="q-section-title">
              <Accessibility size={18} aria-hidden /> Accessibility
            </h2>
            <Switch
              checked={appearance.highContrast}
              onChange={(highContrast) => update({ highContrast })}
              label="High contrast"
              description="Solid panels, stronger borders and text at 7:1 contrast or more."
              data-testid="high-contrast"
            />
            <details style={{ marginTop: 14 }}>
              <summary className="small" style={{ cursor: 'pointer' }}>
                Contrast check for this theme: {report.filter((r) => r.passes).length} of {report.length} pairs pass
              </summary>
              <table className="data q-contrast-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Pair</th>
                    <th className="num">Ratio</th>
                    <th className="num">Needs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.label}>
                      <td>
                        <span className="q-dot" style={{ background: r.foreground }} /> on{' '}
                        <span className="q-dot" style={{ background: r.background }} /> {r.label}
                      </td>
                      <td className="num mono">{r.ratio.toFixed(2)}:1</td>
                      <td className="num mono">{r.required}:1</td>
                      <td>{r.passes ? <Badge tone="good">Pass</Badge> : <Badge tone="bad">Fail</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Surface>

          <Surface>
            <h2 className="q-section-title">
              <Building2 size={18} aria-hidden /> Organization default
            </h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              {organizationDefault
                ? `${me?.tenant.name ?? 'Your organization'} uses ${PRESETS[organizationDefault.preset].name} (${organizationDefault.mode}) for members who have not chosen their own.`
                : 'No organization default is set, so members start with Quantum Midnight.'}
            </p>
            <div className="row">
              {source === 'personal' ? (
                <Button onClick={() => void resetToOrganization()} data-testid="use-org-default">
                  {organizationDefault ? 'Use the organization default' : 'Use the ZAPX default'}
                </Button>
              ) : null}
              {isAdmin ? (
                <>
                  <Button variant="primary" loading={orgBusy} onClick={() => void orgAction(appearance)} data-testid="set-org-default">
                    Make this the organization default
                  </Button>
                  {organizationDefault ? (
                    <Button variant="ghost" disabled={orgBusy} onClick={() => void orgAction(null)}>
                      Clear organization default
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
            {orgMessage ? (
              <p className="small" role="status" style={{ marginBottom: 0 }}>
                {orgMessage}
              </p>
            ) : null}
          </Surface>
        </div>

        <div className="q-sticky">
          <ComponentPreview />
        </div>
      </div>
    </Shell>
  );
}
