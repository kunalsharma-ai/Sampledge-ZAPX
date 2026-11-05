import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey, answerText, checkGeofence, distanceM, fromZapxXml, simulateSurvey, toZapxXml, validatePage } from './index.js';

const def = (() => {
  const p = parseSurveyDefinition({
    schemaVersion: 1,
    title: 'Fieldwork',
    pages: [
      {
        id: 'P1',
        questions: [
          { id: 'SIG', type: 'signature', text: 'Please sign to confirm the visit' },
          { id: 'EAN', type: 'barcode', text: 'Scan the pack', pattern: '^\\d{13}$' },
          { id: 'CODE', type: 'barcode', text: 'Scan any code', required: false },
        ],
      },
    ],
  });
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.definition as SurveyDefinition;
})();
const page = def.pages[0]!;

describe('signature and barcode questions', () => {
  it('accepts a drawn signature and rejects a tap or junk', () => {
    const ok = validatePage(def, page, {}, { SIG: '10,20 30,40 50,60;100,100 120,130', EAN: '4006381333931' });
    expect(ok.ok).toBe(true);
    expect(answerText(def, 'SIG', ok.ok ? ok.answers : {})).toBe('signed');
    for (const bad of ['10,20', 'x', '<svg/>', '2000,20 30,40', '10,20 30,900']) {
      const r = validatePage(def, page, {}, { SIG: bad, EAN: '4006381333931' });
      expect(r.ok, bad).toBe(false);
    }
  });

  it('checks a code against its pattern and trims it', () => {
    const r = validatePage(def, page, {}, { SIG: '1,1 2,2', EAN: ' 4006381333931 ', CODE: 'https://x.test/q' });
    expect(r.ok && r.answers).toMatchObject({ EAN: '4006381333931', CODE: 'https://x.test/q' });
    const bad = validatePage(def, page, {}, { SIG: '1,1 2,2', EAN: 'ABC' });
    expect(bad.ok).toBe(false);
  });

  it('passes analysis, simulation and the XML round trip', () => {
    expect(analyzeSurvey(def).issues.filter((i) => i.severity === 'error')).toEqual([]);
    const sim = simulateSurvey(def, { respondents: 20, seed: 's' });
    expect(sim.outcomes.complete).toBe(20);
    const back = fromZapxXml(toZapxXml(def));
    const parsed = parseSurveyDefinition(back.definition);
    expect(parsed.ok && parsed.definition.pages[0]!.questions).toEqual(def.pages[0]!.questions);
  });
});

describe('geofences', () => {
  const fences = [
    { label: 'Connaught Place', lat: 28.6315, lon: 77.2167, radiusM: 1000 },
    { label: 'Gurgaon', lat: 28.4595, lon: 77.0266, radiusM: 3000 },
  ];
  it('measures distance', () => {
    expect(Math.round(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) / 1000)).toBe(111);
  });
  it('is open without areas, and needs a location when areas are set', () => {
    expect(checkGeofence(null, [])).toMatchObject({ open: true, inside: true });
    expect(checkGeofence(null, fences)).toMatchObject({ open: false, inside: false, nearest: null });
  });
  it('finds the nearest area and gives the benefit of GPS accuracy', () => {
    expect(checkGeofence({ lat: 28.632, lon: 77.217 }, fences)).toMatchObject({
      inside: true,
      nearest: { label: 'Connaught Place', distanceM: 0 },
    });
    const out = checkGeofence({ lat: 28.65, lon: 77.2167 }, fences);
    expect(out.inside).toBe(false);
    expect(out.nearest!.label).toBe('Connaught Place');
    expect(out.nearest!.distanceM).toBeGreaterThan(900);
    expect(checkGeofence({ lat: 28.645, lon: 77.2167, accuracy: 800 }, fences).inside).toBe(true);
    // A useless fix (50 km) is capped at 1 km and cannot cover the city.
    expect(checkGeofence({ lat: 28.7, lon: 77.2167, accuracy: 50_000 }, fences).inside).toBe(false);
  });
});
