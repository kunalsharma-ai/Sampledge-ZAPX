/**
 * The respondent side of webcam eye tracking (experimental): consent, camera, face check,
 * calibration dots, then the picture for a few seconds while the gaze is estimated on the device.
 * The camera image never leaves the browser and is not recorded; only the estimated points on the
 * picture are kept (see formatEyeTrack). The face landmarks come from the host (EyeTrackingHost).
 */
import { useEffect, useRef, useState } from 'react';
import { formatEyeTrack, parseEyeTrack, type AnswerValue, type EyeTrackQuestion, type GazeSample } from '@zapx/survey-schema';
import {
  CALIBRATION_POINTS,
  CHECK_POINTS,
  calibrationErrorPct,
  fitGaze,
  gazeFeatures,
  predictGaze,
  smoother,
  toPicture,
  type Point3,
} from './gaze';

/** Face landmarks for one video frame (a full face mesh with irises), or null when no face is found. */
export interface FaceLandmarkSource {
  detect: (video: HTMLVideoElement, nowMs: number) => Point3[] | null;
  close: () => void;
}

/** What a host must provide for eye tracking. Without it, the task says it is not available here. */
export interface EyeTrackingHost {
  createFaceTracker: () => Promise<FaceLandmarkSource>;
}

export interface EyeTrackMessages {
  eyeIntro: string;
  eyeAgree: string;
  eyeSkip: string;
  eyeStarting: string;
  eyePosition: string;
  eyeStartCalibration: string;
  eyeCalibrate: string;
  eyeDot: string;
  eyeRetry: string;
  eyeLook: string;
  eyeStop: string;
  eyeDone: string;
  eyeSkipped: string;
  eyeUnavailable: string;
  eyeNoFace: string;
  eyeCalibrationFailed: string;
  eyeExperimental: string;
}
export const DEFAULT_EYE_MESSAGES: EyeTrackMessages = {
  eyeIntro: 'Eye tracking',
  eyeAgree: 'I agree, turn on the camera',
  eyeSkip: 'Skip this task',
  eyeStarting: 'Starting the camera…',
  eyePosition: 'Sit about an arm’s length from the screen with your face in good light. Keep your head still.',
  eyeStartCalibration: 'Start',
  eyeCalibrate: 'Look at each dot and click it. Keep your head still.',
  eyeDot: 'Dot {n} of {total}',
  eyeRetry: 'That was not accurate enough. Let’s try once more.',
  eyeLook: 'Look at the picture as you normally would.',
  eyeStop: 'Stop',
  eyeDone: 'Thank you, this task is done.',
  eyeSkipped: 'You skipped this task.',
  eyeUnavailable: 'Eye tracking is not available on this device or browser. You can continue.',
  eyeNoFace: 'We could not see a face in the camera. You can continue.',
  eyeCalibrationFailed: 'The calibration was not accurate enough. You can continue.',
  eyeExperimental: 'Experimental: the camera estimate of where you look is approximate.',
};

type Phase = 'intro' | 'starting' | 'position' | 'calibrating' | 'viewing' | 'finished';

const FACE_TIMEOUT_MS = 20_000;
const DOT_COLLECT_MS = 700;
const SAMPLE_EVERY_MS = 50;

const fill = (t: string, v: Record<string, number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

export function EyeTrack({
  question: q,
  value,
  onChange,
  imageUrl,
  host,
  messages,
}: {
  question: EyeTrackQuestion;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  imageUrl?: string;
  host?: EyeTrackingHost;
  messages: EyeTrackMessages;
}) {
  const answered = parseEyeTrack(value);
  const [phase, setPhase] = useState<Phase>(answered || !host ? 'finished' : 'intro');
  const [dot, setDot] = useState(0);
  const [faceSeen, setFaceSeen] = useState(false);
  const [note, setNote] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<FaceLandmarkSource | null>(null);
  const loop = useRef<number | null>(null);
  const collect = useRef<{ until: number; into: Array<{ f: number[]; x: number; y: number }>; x: number; y: number } | null>(null);
  const calib = useRef<Array<{ f: number[]; x: number; y: number }>>([]);
  const checks = useRef<Array<{ f: number[]; x: number; y: number }>>([]);
  const attempts = useRef(0);
  const finishWith = useRef<(v: string) => void>(() => undefined);

  const stopCamera = () => {
    if (loop.current !== null) cancelAnimationFrame(loop.current);
    loop.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    tracker.current?.close();
    tracker.current = null;
  };
  finishWith.current = (v: string) => {
    stopCamera();
    onChange(v);
    setPhase('finished');
  };
  useEffect(() => stopCamera, []);

  // Without a host (studio preview, the offline app) the task cannot run: it is stored as unavailable.
  useEffect(() => {
    if (!host && !answered) onChange('unavailable');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  const features = (): number[] | null => {
    const v = videoRef.current;
    if (!v || !tracker.current || v.readyState < 2) return null;
    const lm = tracker.current.detect(v, performance.now());
    return lm ? gazeFeatures(lm) : null;
  };

  const start = async () => {
    if (!host) return;
    setPhase('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      tracker.current = await host.createFaceTracker();
    } catch {
      finishWith.current('unavailable');
      return;
    }
    const v = videoRef.current!;
    v.srcObject = stream.current;
    await v.play().catch(() => undefined);
    setPhase('position');
    const began = performance.now();
    let seen = 0;
    const tick = () => {
      if (!tracker.current) return;
      const f = features();
      seen = f ? seen + 1 : 0;
      if (seen >= 8) setFaceSeen(true);
      else if (performance.now() - began > FACE_TIMEOUT_MS && !f) return finishWith.current('no_face');
      loop.current = requestAnimationFrame(tick);
    };
    loop.current = requestAnimationFrame(tick);
  };

  const points = [...CALIBRATION_POINTS, ...CHECK_POINTS];

  const startCalibration = () => {
    if (loop.current !== null) cancelAnimationFrame(loop.current);
    calib.current = [];
    checks.current = [];
    setDot(0);
    setPhase('calibrating');
    const tick = () => {
      if (!tracker.current) return;
      const c = collect.current;
      if (c) {
        const f = features();
        if (f) c.into.push({ f, x: c.x, y: c.y });
        if (performance.now() >= c.until) {
          collect.current = null;
          setDot((d) => d + 1);
        }
      }
      loop.current = requestAnimationFrame(tick);
    };
    loop.current = requestAnimationFrame(tick);
  };

  const clickDot = (i: number) => {
    if (collect.current) return;
    const p = points[i]!;
    collect.current = {
      until: performance.now() + DOT_COLLECT_MS,
      into: i < CALIBRATION_POINTS.length ? calib.current : checks.current,
      x: p.x,
      y: p.y,
    };
  };

  // All dots done: fit, measure, then show the picture (or retry once, or give up).
  useEffect(() => {
    if (phase !== 'calibrating' || dot < points.length) return;
    if (calib.current.length < 20 || checks.current.length < 4) return finishWith.current('no_face');
    const model = fitGaze(calib.current);
    const errorPct = calibrationErrorPct(model, checks.current, { width: window.innerWidth, height: window.innerHeight });
    if (errorPct > q.maxErrorPct && attempts.current === 0) {
      attempts.current++;
      setNote(messages.eyeRetry);
      return startCalibration();
    }
    if (errorPct > q.maxErrorPct * 2) return finishWith.current('calibration_failed');
    setNote('');
    setPhase('viewing');
    const samples: GazeSample[] = [];
    const smooth = smoother();
    let began = 0;
    let lastAt = -Infinity;
    const tick = () => {
      if (!tracker.current) return;
      const now = performance.now();
      if (!began) began = now;
      const t = now - began;
      if (t >= q.durationSec * 1000) {
        return finishWith.current(formatEyeTrack({ status: 'recorded', errorPct, durationMs: q.durationSec * 1000, samples }));
      }
      if (now - lastAt >= SAMPLE_EVERY_MS) {
        lastAt = now;
        const f = features();
        const p = smooth.next(f ? predictGaze(model, f) : null);
        const box = imgRef.current?.getBoundingClientRect();
        const at = p && box ? toPicture(p.x * window.innerWidth, p.y * window.innerHeight, box) : null;
        samples.push({ t: Math.round(t), x: at?.x ?? null, y: at?.y ?? null });
      }
      loop.current = requestAnimationFrame(tick);
    };
    loop.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dot, phase]);

  const stop = () => finishWith.current('declined');

  const status = parseEyeTrack(value)?.status;
  const overlay = phase === 'calibrating' || phase === 'viewing';
  return (
    <div className="zx-eyetrack" data-phase={phase}>
      <p className="zx-help zx-eyetrack-experimental">{messages.eyeExperimental}</p>
      {/* The camera picture stays on the device; it is shown only while the face is positioned. */}
      <video
        ref={videoRef}
        className={phase === 'position' ? 'zx-eyetrack-video' : 'zx-eyetrack-video zx-eyetrack-hidden'}
        muted
        playsInline
        aria-hidden="true"
      />
      {phase === 'intro' ? (
        <div className="zx-eyetrack-intro">
          <p>{q.consentText}</p>
          <div className="zx-eyetrack-actions">
            <button type="button" className="zx-button" onClick={() => void start()} disabled={!host}>
              {messages.eyeAgree}
            </button>
            <button type="button" className="zx-button zx-secondary" onClick={() => finishWith.current('declined')}>
              {messages.eyeSkip}
            </button>
          </div>
        </div>
      ) : null}
      {phase === 'starting' ? <p role="status">{messages.eyeStarting}</p> : null}
      {phase === 'position' ? (
        <div className="zx-eyetrack-intro">
          <p role="status">{messages.eyePosition}</p>
          <div className="zx-eyetrack-actions">
            <button type="button" className="zx-button" disabled={!faceSeen} onClick={startCalibration}>
              {messages.eyeStartCalibration}
            </button>
            <button type="button" className="zx-button zx-secondary" onClick={stop}>
              {messages.eyeStop}
            </button>
          </div>
        </div>
      ) : null}
      {overlay ? (
        <div className="zx-eyetrack-overlay" role="dialog" aria-modal="true" aria-label={messages.eyeIntro}>
          <button type="button" className="zx-button zx-secondary zx-eyetrack-stop" onClick={stop}>
            {messages.eyeStop}
          </button>
          {phase === 'calibrating' && dot < points.length ? (
            <>
              <p className="zx-eyetrack-instruction" role="status">
                {note || messages.eyeCalibrate}
              </p>
              <button
                type="button"
                className="zx-eyetrack-dot"
                style={{ left: `${points[dot]!.x * 100}%`, top: `${points[dot]!.y * 100}%` }}
                aria-label={fill(messages.eyeDot, { n: dot + 1, total: points.length })}
                onClick={() => clickDot(dot)}
              />
            </>
          ) : null}
          {phase === 'viewing' ? (
            <>
              <p className="zx-sr-only" role="status">
                {messages.eyeLook}
              </p>
              <img ref={imgRef} className="zx-eyetrack-picture" src={imageUrl} alt={q.imageAlt} />
            </>
          ) : null}
        </div>
      ) : null}
      {phase === 'finished' ? (
        <p role="status" className="zx-eyetrack-result" data-status={status}>
          {status === 'recorded'
            ? messages.eyeDone
            : status === 'declined'
              ? messages.eyeSkipped
              : status === 'no_face'
                ? messages.eyeNoFace
                : status === 'calibration_failed'
                  ? messages.eyeCalibrationFailed
                  : messages.eyeUnavailable}
        </p>
      ) : null}
    </div>
  );
}

export const EYETRACK_CSS = `
.zx-eyetrack-intro{display:flex;flex-direction:column;gap:12px;max-width:640px;}
.zx-eyetrack-actions{display:flex;gap:8px;flex-wrap:wrap;}
.zx-eyetrack-experimental{font-size:.85em;}
.zx-eyetrack-video{width:240px;max-width:100%;border-radius:var(--zx-radius);transform:scaleX(-1);background:#000;}
.zx-eyetrack-hidden{position:fixed;width:2px;height:2px;opacity:0;pointer-events:none;left:0;top:0;}
.zx-eyetrack-overlay{position:fixed;inset:0;z-index:2147483000;background:var(--zx-bg,#fff);color:var(--zx-text,#111);}
.zx-eyetrack-instruction{position:absolute;left:50%;top:50%;transform:translate(-50%,calc(-50% - 56px));margin:0;text-align:center;max-width:80vw;}
.zx-eyetrack-dot{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:4px solid var(--zx-accent);background:radial-gradient(circle,var(--zx-accent) 0 4px,transparent 5px);cursor:pointer;padding:0;animation:zx-eyetrack-pulse 1s ease-in-out infinite;}
@keyframes zx-eyetrack-pulse{50%{transform:scale(.8)}}
@media (prefers-reduced-motion:reduce){.zx-eyetrack-dot{animation:none}}
.zx-eyetrack-picture{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);max-width:92vw;max-height:92vh;}
.zx-eyetrack-stop{position:absolute;right:12px;top:12px;z-index:1;}
`;
