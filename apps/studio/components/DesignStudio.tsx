'use client';
/**
 * Experience Studio: the respondent look (theme, logo, motion) and device rules. Presentation only;
 * nothing here can change questions, answer codes or routing.
 */
import { useState } from 'react';
import { THEME_PRESETS, themeWarnings } from '@zapx/survey-renderer';
import { DEVICE_TYPES, LOGO_MAX_BYTES, THEME_FONTS, THEME_MOTION, type DeviceType, type Presentation, type SurveyDefinition, type Theme } from '@zapx/survey-schema';
import { Preview } from './Preview';

const FONT_NAMES: Record<Theme['font'], string> = { system: 'System (default)', humanist: 'Humanist sans', rounded: 'Rounded', serif: 'Serif' };
const MOTION_NAMES: Record<Theme['motion'], string> = { none: 'None', subtle: 'Subtle fade', lively: 'Lively slide and pop' };
const DEVICE_NAMES: Record<DeviceType, string> = { desktop: 'Desktop and laptop', tablet: 'Tablet', mobile: 'Phone' };

export function DesignStudio({
  def,
  presentation,
  readOnly,
  onChange,
}: {
  def: SurveyDefinition;
  presentation: Presentation;
  readOnly: boolean;
  onChange: (p: Presentation) => void;
}) {
  const [logoError, setLogoError] = useState<string | null>(null);
  const theme = presentation.theme;
  const setTheme = (patch: Partial<Theme>) => onChange({ ...presentation, theme: { ...theme, ...patch } });
  const warnings = themeWarnings(theme);

  const onLogo = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setLogoError('Use a PNG, JPEG or WebP image.');
    if (file.size > LOGO_MAX_BYTES) return setLogoError(`The logo must be ${Math.round(LOGO_MAX_BYTES / 1000)} KB or smaller.`);
    const reader = new FileReader();
    reader.onload = () => setTheme({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const color = (key: 'accent' | 'background' | 'surface' | 'text', label: string) => (
    <label className="field" style={{ flex: '1 1 120px' }}>
      {label}
      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input type="color" value={theme[key]} onChange={(e) => setTheme({ [key]: e.target.value, preset: 'custom' })} disabled={readOnly} aria-label={`${label} colour`} style={{ width: 40, padding: 2 }} />
        <input value={theme[key]} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && setTheme({ [key]: e.target.value, preset: 'custom' })} disabled={readOnly} aria-label={`${label} hex`} className="mono" style={{ width: 90 }} />
      </span>
    </label>
  );

  return (
    <div className="editor" style={{ gridTemplateColumns: '380px minmax(0,1fr)' }}>
      <div className="stack">
        <fieldset className="panel stack" disabled={readOnly} style={{ margin: 0 }}>
          <h2>Theme</h2>
          <div className="row" role="group" aria-label="Theme presets" style={{ gap: 6 }}>
            {Object.entries(THEME_PRESETS).map(([key, p]) => (
              <button
                key={key}
                aria-pressed={theme.preset === key}
                onClick={() => setTheme({ ...p.theme, preset: key })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, background: p.theme.accent, border: `3px solid ${p.theme.background}` }} />
                {p.name}
              </button>
            ))}
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            {color('accent', 'Accent')}
            {color('text', 'Text')}
            {color('surface', 'Card')}
            {color('background', 'Page')}
          </div>
          {warnings.map((w) => (
            <p key={w} className="small" style={{ color: 'var(--warn)', margin: 0 }} role="status">
              ⚠ {w}
            </p>
          ))}
          <div className="row">
            <label className="field">
              Dark mode
              <select value={theme.colorScheme} onChange={(e) => setTheme({ colorScheme: e.target.value as Theme['colorScheme'] })}>
                <option value="auto">Follow respondent (built-in dark palette)</option>
                <option value="light">Always use these colours</option>
              </select>
            </label>
            <label className="field">
              Font
              <select value={theme.font} onChange={(e) => setTheme({ font: e.target.value as Theme['font'] })}>
                {THEME_FONTS.map((f) => (
                  <option key={f} value={f}>
                    {FONT_NAMES[f]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              Corner radius: {theme.radius}px
              <input type="range" min={0} max={28} value={theme.radius} onChange={(e) => setTheme({ radius: Number(e.target.value) })} />
            </label>
            <label className="field">
              Spacing
              <select value={theme.density} onChange={(e) => setTheme({ density: e.target.value as Theme['density'] })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </label>
          </div>
          <div className="row">
            <label className="field">
              Motion
              <select value={theme.motion} onChange={(e) => setTheme({ motion: e.target.value as Theme['motion'] })}>
                {THEME_MOTION.map((m) => (
                  <option key={m} value={m}>
                    {MOTION_NAMES[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Progress
              <select value={theme.progress} onChange={(e) => setTheme({ progress: e.target.value as Theme['progress'] })}>
                <option value="bar">Bar</option>
                <option value="percent">Percentage</option>
                <option value="none">Hidden</option>
              </select>
            </label>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Respondents whose device asks for reduced motion never see animations. No web fonts are loaded, so respondents' browsers make no
            third-party requests.
          </p>
          <h3 style={{ marginTop: 8 }}>Logo</h3>
          {theme.logo ? (
            <div className="row">
              <img src={theme.logo} alt="" style={{ maxHeight: 40, maxWidth: 160, background: theme.surface, padding: 4, borderRadius: 6 }} />
              <button className="danger" onClick={() => setTheme({ logo: undefined })}>
                Remove
              </button>
            </div>
          ) : null}
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload logo" onChange={(e) => onLogo(e.target.files?.[0])} />
          {logoError ? <p className="error-text small">{logoError}</p> : null}
          <label className="field">
            Logo description (for screen readers)
            <input value={theme.logoAlt ?? ''} onChange={(e) => setTheme({ logoAlt: e.target.value || undefined })} placeholder="e.g. Acme Research" />
          </label>
          <h3 style={{ marginTop: 8 }}>Buttons</h3>
          <div className="row">
            <label className="field">
              Next button
              <input value={theme.nextLabel ?? ''} placeholder="Next" onChange={(e) => setTheme({ nextLabel: e.target.value || undefined })} style={{ width: 140 }} />
            </label>
            <label className="field">
              Back button
              <input value={theme.backLabel ?? ''} placeholder="Back" onChange={(e) => setTheme({ backLabel: e.target.value || undefined })} style={{ width: 140 }} />
            </label>
          </div>
        </fieldset>

        <fieldset className="panel stack" disabled={readOnly} style={{ margin: 0 }} data-testid="device-settings">
          <h2>Devices</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Respondents on a device that is not allowed are screened out before the survey starts and sent back to the vendor as a terminate.
          </p>
          {DEVICE_TYPES.map((d) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                checked={presentation.devices.allowed.includes(d)}
                onChange={(e) => {
                  const allowed = e.target.checked ? [...presentation.devices.allowed, d] : presentation.devices.allowed.filter((x) => x !== d);
                  if (allowed.length) onChange({ ...presentation, devices: { ...presentation.devices, allowed: DEVICE_TYPES.filter((x) => allowed.includes(x)) } });
                }}
              />
              {DEVICE_NAMES[d]}
            </label>
          ))}
          <label className="field">
            Grids on narrow screens
            <select
              value={presentation.devices.gridOnMobile}
              onChange={(e) => onChange({ ...presentation, devices: { ...presentation.devices, gridOnMobile: e.target.value as 'cards' | 'scroll' } })}
            >
              <option value="cards">One card per row (recommended)</option>
              <option value="scroll">Full table, scroll sideways</option>
            </select>
          </label>
        </fieldset>
      </div>
      <Preview key={`${def.pages.length}-${presentation.languages.length}`} def={def} presentation={presentation} />
    </div>
  );
}
