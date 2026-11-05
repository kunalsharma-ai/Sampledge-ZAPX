'use client';
import { useState } from 'react';
import { CheckCircle2, ClipboardCheck, Radio, Timer } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  KpiTile,
  ProgressMeter,
  SegmentedControl,
  Skeleton,
  Surface,
  Switch,
  TextField,
} from '@/components/quantum';

const TOKENS = [
  ['--q-bg', 'Page'],
  ['--q-surface', 'Panel'],
  ['--q-surface-3', 'Raised row'],
  ['--q-text', 'Text'],
  ['--q-text-muted', 'Secondary text'],
  ['--q-border-strong', 'Input border'],
  ['--q-accent', 'Accent'],
  ['--q-accent-soft', 'Accent soft'],
  ['--q-good', 'Success'],
  ['--q-warn', 'Warning'],
  ['--q-bad', 'Error'],
  ['--q-info', 'Info'],
] as const;

/**
 * Live preview of the Quantum components in the active theme. The numbers are sample values for
 * the preview only and are labelled as such; nothing here reads or changes survey data.
 */
export function ComponentPreview() {
  const [name, setName] = useState('Brand tracker W2');
  const [code, setCode] = useState('Q1');
  const [autosave, setAutosave] = useState(true);
  const [mobile, setMobile] = useState(true);
  const [view, setView] = useState<'visual' | 'code'>('visual');
  const [loading, setLoading] = useState(false);
  const codeError = /^[A-Za-z][A-Za-z0-9_]*$/.test(code) ? null : 'Start with a letter; use letters, digits and _ only.';

  return (
    <Surface data-testid="component-preview">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Live preview</h2>
        <Badge tone="neutral">Sample values</Badge>
      </div>
      <div className="stack">
        <div className="grid2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <KpiTile label="Completes" value={1284} icon={<CheckCircle2 size={14} />} delta={{ text: '+12% vs last week', tone: 'good' }} />
          <KpiTile
            label="Median length"
            value={14.2}
            format={(n) => `${n.toFixed(1)} min`}
            icon={<Timer size={14} />}
            delta={{ text: 'Target 15 min', tone: 'neutral' }}
          />
        </div>
        <ProgressMeter label="Quota: IT decision makers" value={172} max={200} thresholds />
        <div className="row" style={{ gap: 6 }}>
          <Badge tone="good" pulse>
            <Radio size={11} aria-hidden /> Live
          </Badge>
          <Badge tone="accent">In testing</Badge>
          <Badge tone="warn">Awaiting approval</Badge>
          <Badge tone="bad">2 logic errors</Badge>
          <Badge tone="info">AI suggestion</Badge>
        </div>
        <TextField label="Survey name" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Question code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          error={codeError}
          hint={codeError ? undefined : 'Used in logic, piping and data exports.'}
          className="mono"
        />
        <SegmentedControl
          label="Logic view"
          value={view}
          onChange={setView}
          options={[
            { value: 'visual', label: 'Visual' },
            { value: 'code', label: 'Code' },
          ]}
        />
        <Switch checked={autosave} onChange={setAutosave} label="Autosave" description="Saves the draft a moment after each change." />
        <Checkbox checked={mobile} onChange={(e) => setMobile(e.target.checked)} label="Check mobile layout before launch" />
        <div className="row" style={{ gap: 8 }}>
          <Button
            variant="primary"
            icon={<ClipboardCheck size={15} />}
            loading={loading}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1200);
            }}
          >
            Run QA
          </Button>
          <Button>Preview</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Close survey</Button>
        </div>
        <div className="stack" style={{ gap: 6 }} aria-label="Loading example">
          <Skeleton width="70%" />
          <Skeleton width="45%" height={10} />
        </div>
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Tokens
          </div>
          <div className="q-token-grid">
            {TOKENS.map(([token, label]) => (
              <span className="q-token" key={token}>
                <span style={{ background: `var(${token})` }} />
                <span>
                  {label}
                  <br />
                  <span className="mono muted">{token}</span>
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </Surface>
  );
}
