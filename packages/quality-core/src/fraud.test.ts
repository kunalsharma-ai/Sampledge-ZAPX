/** Milestone 12 fraud and face-to-face checks. */
import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import { assessQuality, distanceMetres, type FraudInput } from './index.js';

function survey(quality: Record<string, unknown> = {}) {
  const parsed = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'F',
    pages: [{ id: 'P1', questions: [{ id: 'WHY', type: 'open', text: 'Why?' }] }],
    settings: { quality },
  });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return parsed.definition;
}
const answers = { WHY: 'Because the price was fair and the staff were helpful.' };
const run = (fraud: FraudInput, quality: Record<string, unknown> = {}) =>
  assessQuality({ def: survey(quality), answers, durationMs: 120_000, medianMs: null, fraud });
const codes = (r: ReturnType<typeof run>) => r.flags.map((f) => f.code);

describe('browser signals', () => {
  it('adds nothing without evidence', () => {
    expect(run({})).toEqual({ score: 100, flags: [] });
    expect(run({ browser: { quietPages: 1, honeypot: 0, pasted: [] } }).score).toBe(100);
  });
  it('flags automation, the honeypot, quiet pages and pasting', () => {
    const r = run({ browser: { automation: true, honeypot: 2, quietPages: 3, pasted: ['WHY', 'WHY'] } });
    expect(codes(r)).toEqual(['automation', 'honeypot', 'no_interaction', 'open_pasted']);
    expect(r.flags.find((f) => f.code === 'no_interaction')!.detail).toBe('3 pages answered without any keyboard, mouse or touch input.');
    expect(r.score).toBe(0);
  });
  it('flags the same device and blocked devices and networks', () => {
    const r = run({ sameDeviceCompletes: 1, blocked: { device: true, network: true } });
    expect(codes(r)).toEqual(['same_device', 'blocked_device', 'blocked_network']);
    expect(r.flags[0]!.detail).toBe('1 other complete came from what looks like the same device.');
  });
  it('is switched off with the fraud setting', () => {
    expect(run({ browser: { automation: true }, sameDeviceCompletes: 4 }, { fraud: false }).score).toBe(100);
  });
});

describe('country', () => {
  it('compares the reported country with the expected ones', () => {
    expect(run({ geo: { country: 'GB', expected: ['GB', 'IE'] } }).score).toBe(100);
    const r = run({ geo: { country: 'VN', expected: ['GB', 'IE'] } });
    expect(r.flags).toEqual([{ code: 'geo_mismatch', penalty: 30, detail: 'Answered from VN; expected GB or IE.' }]);
    expect(run({ geo: { country: 'VN', expected: [] } }).score).toBe(100);
  });
});

describe('face to face', () => {
  const home = { lat: 51.5007, lon: -0.1246, accuracy: 12 };
  it('measures distances', () => {
    expect(Math.round(distanceMetres(home, { lat: 51.5033, lon: -0.1196 }))).toBe(451);
  });
  it('flags a missing location, moving away and overlapping interviews', () => {
    expect(codes(run({ capi: { gpsRequired: true, start: home, end: null } }))).toEqual(['gps_missing']);
    expect(codes(run({ capi: { gpsRequired: false } }))).toEqual([]);
    const far = run({ capi: { gpsRequired: true, start: home, end: { lat: 51.52, lon: -0.1246 }, overlapping: 2 } });
    expect(codes(far)).toEqual(['gps_moved', 'interviewer_overlap']);
    expect(far.flags[0]!.detail).toBe('The interview ended 2.1 km from where it started.');
    expect(far.flags[1]!.detail).toBe('The interviewer recorded 2 other interviews at the same time.');
  });
});
