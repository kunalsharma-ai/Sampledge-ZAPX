import { describe, expect, it } from 'vitest';
import { formatEyeTrack, parseEyeTrack, surveyDefinitionSchema, type SurveyDefinition } from '@zapx/survey-schema';
import { analyzeSurvey } from './analyze';
import { validatePage } from './interview';
import { fromZapxXml, toZapxXml } from './xml';
import { simulateSurvey } from './simulate';
import { textKeys } from './localize';

const def: SurveyDefinition = surveyDefinitionSchema.parse({
  schemaVersion: 1,
  title: 'Shelf',
  pages: [
    {
      id: 'P1',
      questions: [
        {
          id: 'EYE',
          type: 'eyetrack',
          text: 'Look at the shelf',
          image: 'img_0123456789',
          imageAlt: 'A supermarket shelf',
          aois: [{ code: 1, label: 'Our pack', x: 10, y: 20, w: 30, h: 40 }],
          durationSec: 5,
        },
      ],
    },
  ],
});
const q = def.pages[0]!.questions[0]!;
const page = def.pages[0]!;
/** The page's verdict on one answer: the stored value, or the error. */
const check = (v: unknown) => {
  const r = validatePage(def, page, {}, { EYE: v });
  return r.ok ? { value: r.answers.EYE } : { error: r.errors[0]?.message };
};

describe('eye-tracking answers', () => {
  it('round-trip between the stored text and the parsed form', () => {
    const a = {
      status: 'recorded' as const,
      errorPct: 7.4,
      durationMs: 5000,
      samples: [
        { t: 0, x: 120, y: 340 },
        { t: 50, x: null, y: null },
        { t: 100, x: 1000, y: 0 },
      ],
    };
    const text = formatEyeTrack(a);
    expect(text).toBe('recorded|74|5000|0,120,340 50,- 100,1000,0');
    expect(parseEyeTrack(text)).toEqual(a);
    expect(parseEyeTrack('declined')).toEqual({ status: 'declined' });
  });

  it('refuses anything that is not a well-formed answer', () => {
    for (const bad of ['', 'yes', 'recorded|74|5000|0,1200,10', 'recorded|74|5000|50,1,1 0,1,1', 'recorded|x|5000|', 42, null])
      expect(parseEyeTrack(bad)).toBeNull();
  });

  it('accepts every outcome, so skips and failures are counted, and checks the length', () => {
    for (const v of ['declined', 'unavailable', 'no_face', 'calibration_failed', 'recorded|50|5000|0,1,1'])
      expect(check(v)).toEqual({ value: v });
    expect(check('recorded|50|9000|0,1,1').error).toMatch(/eye-tracking/);
    expect(check({ status: 'recorded' }).error).toMatch(/eye-tracking/);
  });
});

describe('eye-tracking questions', () => {
  it('need a picture, and always say they are experimental', () => {
    const noPicture = surveyDefinitionSchema.parse({ ...def, pages: [{ id: 'P1', questions: [{ ...q, image: undefined }] }] });
    const codes = analyzeSurvey(noPicture).issues.map((i) => `${i.severity}:${i.code}`);
    expect(codes).toContain('error:MEDIA');
    expect(codes).toContain('warning:EXPERIMENTAL');
  });

  it('round-trip through SampCode XML with their areas of interest', () => {
    const xml = toZapxXml(def);
    expect(xml).toContain('<aoi code="1"');
    const back = fromZapxXml(xml);
    expect(back.warnings).toEqual([]);
    expect(surveyDefinitionSchema.parse(back.definition)).toEqual(def);
  });

  it('put the picture description and consent text up for translation', () => {
    const keys = textKeys(def).map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(['q.EYE.imageAlt', 'q.EYE.consent']));
  });

  it('get valid synthetic answers in simulation', () => {
    const answers: unknown[] = [];
    const sim = simulateSurvey(def, { respondents: 20, seed: 'eye', onInterview: (i) => answers.push(i.answers.EYE) });
    expect(sim.outcomes.complete).toBe(20);
    expect(answers).toContain('declined');
    for (const a of answers) expect(check(a)).toEqual({ value: a });
  });
});
