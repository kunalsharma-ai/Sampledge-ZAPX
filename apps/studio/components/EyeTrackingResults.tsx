'use client';
/**
 * Webcam eye tracking results (experimental): who took part, calibration accuracy, a heatmap over the
 * picture and the areas of interest. Every number is approximate: the gaze is a browser estimate that
 * has not been validated on real webcams.
 */
import { useEffect, useRef, useState } from 'react';
import type { SurveyDefinition } from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { ErrorNote } from './Shell';
import { mediaSrc } from './MediaLibrary';
import { InfoTip } from '@/components/neon/InfoTip';

interface EyeOut {
  questionId: string;
  image: string | null;
  total: number;
  result: {
    answered: number;
    statuses: Record<'recorded' | 'declined' | 'unavailable' | 'no_face' | 'calibration_failed', number>;
    included: number;
    tooInaccurate: number;
    maxErrorPct: number;
    accuracy: { medianPct: number; bestPct: number; worstPct: number } | null;
    onPicturePct: number;
    heatmap: number[];
    aois: Array<{
      code: number;
      label: string;
      viewersPct: number;
      dwellSharePct: number;
      meanDwellMs: number;
      meanFirstLookMs: number | null;
    }>;
  };
}

const STATUS_TEXT: Record<keyof EyeOut['result']['statuses'], string> = {
  recorded: 'Recorded',
  declined: 'Skipped by the respondent',
  unavailable: 'No camera or not supported',
  no_face: 'No face found',
  calibration_failed: 'Calibration failed',
};

function Heatmap({
  values,
  image,
  aois,
}: {
  values: number[];
  image: string | null;
  aois: Array<{ x: number; y: number; w: number; h: number; label: string; code: number }>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const n = Math.round(Math.sqrt(values.length));
  useEffect(() => {
    const c = canvas.current;
    if (!c || !n) return;
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    values.forEach((v, i) => {
      // One warm hue; how much was looked at shows as opacity, so the picture stays readable.
      img.data[i * 4] = 236;
      img.data[i * 4 + 1] = Math.round(72 + 120 * (1 - v));
      img.data[i * 4 + 2] = 40;
      img.data[i * 4 + 3] = Math.round(Math.min(1, v * 1.15) * 200);
    });
    ctx.putImageData(img, 0, 0);
  }, [values, n]);
  return (
    <div className="eye-heatmap" data-testid="eye-heatmap">
      {image ? <img src={mediaSrc(image)} alt="" /> : <div className="eye-heatmap-blank" />}
      <canvas ref={canvas} aria-label="Heatmap of where respondents looked" role="img" />
      {aois.map((a) => (
        <span key={a.code} className="eye-aoi" style={{ left: `${a.x}%`, top: `${a.y}%`, width: `${a.w}%`, height: `${a.h}%` }}>
          {a.label}
        </span>
      ))}
    </div>
  );
}

export function EyeTrackingResults({ surveyId, def }: { surveyId: string; def: SurveyDefinition }) {
  const questions = def.pages.flatMap((p) => p.questions).filter((q) => q.type === 'eyetrack');
  const [pick, setPick] = useState(questions[0]?.id ?? '');
  const [out, setOut] = useState<EyeOut | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!questions.length) return null;
  const q = questions.find((x) => x.id === pick);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOut(await api(`/surveys/${surveyId}/analysis/eyetracking/${pick}`, { method: 'POST', body: {} }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const r = out?.result;
  return (
    <section className="panel stack" data-testid="eye-results">
      <h2 style={{ margin: 0 }}>
        Eye tracking (experimental)
        <InfoTip k="section.eyeResults" />
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Gaze is estimated from each respondent&apos;s webcam in their browser. It has not been validated on real webcams, so treat the
        heatmap and the figures below as approximate. &quot;Time to first look&quot; is the first estimated gaze point in the area, not a
        measured fixation.
      </p>
      <div className="row">
        <label className="field">
          Eye-tracking question
          <select value={pick} onChange={(e) => (setPick(e.target.value), setOut(null))}>
            {questions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.id}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? 'Working…' : 'Show results'}
        </button>
      </div>
      <ErrorNote error={error} />
      {r ? (
        <>
          <p className="small" data-testid="eye-summary" style={{ margin: 0 }}>
            {r.included} of {r.answered} respondents used
            {r.accuracy
              ? ` · median calibration error ${r.accuracy.medianPct}% of the screen width (best ${r.accuracy.bestPct}%, worst ${r.accuracy.worstPct}%)`
              : ''}
            {r.tooInaccurate ? ` · ${r.tooInaccurate} left out as less accurate than ${r.maxErrorPct}%` : ''}
            {r.included ? ` · gaze on the picture ${r.onPicturePct}% of the time` : ''}
          </p>
          <table className="data small" data-testid="eye-statuses">
            <tbody>
              {(Object.keys(STATUS_TEXT) as Array<keyof typeof STATUS_TEXT>).map((k) => (
                <tr key={k}>
                  <th scope="row">{STATUS_TEXT[k]}</th>
                  <td className="num">{r.statuses[k]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.included ? <Heatmap values={r.heatmap} image={out!.image} aois={q?.type === 'eyetrack' ? q.aois : []} /> : null}
          {r.aois.length ? (
            <table className="data" data-testid="eye-aois">
              <thead>
                <tr>
                  <th>Area of interest</th>
                  <th className="num">Looked at it</th>
                  <th className="num">Share of looking time</th>
                  <th className="num">Mean time in it</th>
                  <th className="num">Mean time to first look</th>
                </tr>
              </thead>
              <tbody>
                {r.aois.map((a) => (
                  <tr key={a.code}>
                    <th scope="row">{a.label}</th>
                    <td className="num">{a.viewersPct}%</td>
                    <td className="num">{a.dwellSharePct}%</td>
                    <td className="num">{(a.meanDwellMs / 1000).toFixed(1)} s</td>
                    <td className="num">{a.meanFirstLookMs === null ? '–' : `${(a.meanFirstLookMs / 1000).toFixed(1)} s`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
