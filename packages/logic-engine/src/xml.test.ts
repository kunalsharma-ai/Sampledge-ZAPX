import { describe, expect, it } from 'vitest';
import { parseSurveyDefinition, surveyDefinitionSchema } from '@zapx/survey-schema';
import { XmlError, analyzeSurvey, fromDecipherStyleXml, fromZapxXml, parseXml, toZapxXml } from './index.js';

const full = surveyDefinitionSchema.parse({
  schemaVersion: 1,
  title: 'Brand & "health" <tracker>',
  welcome: 'Welcome!\nTwo lines.',
  pages: [
    {
      id: 'P1',
      title: 'Screener',
      questions: [
        { id: 'AGE', type: 'numeric', text: 'Age?', min: 18, max: 99, validations: [{ expr: 'AGE != 50', message: 'No 50 & up' }] },
        {
          id: 'AWARE',
          type: 'multi',
          text: 'Which brands?',
          help: 'Select all',
          options: [
            { code: 1, label: 'Acme' },
            { code: 2, label: 'Globex' },
            { code: 99, label: 'None', exclusive: true, anchor: true },
          ],
          randomize: true,
          maxSelected: 2,
        },
      ],
    },
    {
      id: 'P2',
      condition: 'AGE >= 18 and not selected(AWARE, 99)',
      questions: [
        {
          id: 'BEST',
          type: 'single',
          text: 'Best?',
          options: [
            { code: 1, label: 'Acme' },
            { code: 2, label: 'Globex' },
          ],
          optionsFrom: { question: 'AWARE' },
        },
        { id: 'NPS', type: 'scale', text: 'Recommend?', nps: true, dontKnow: { code: 99, label: "Don't know" } },
        {
          id: 'G',
          type: 'grid',
          text: 'Rate',
          rows: [{ id: 'r1', label: 'Price' }],
          columns: [
            { code: 1, label: 'Bad' },
            { code: 2, label: 'Good' },
          ],
        },
        {
          id: 'SORT',
          type: 'cardsort',
          text: 'Sort',
          options: [
            { code: 1, label: 'A' },
            { code: 2, label: 'B' },
          ],
          groups: [
            { code: 1, label: 'X' },
            { code: 2, label: 'Y' },
          ],
        },
        {
          id: 'SPOT',
          type: 'hotspot',
          text: 'Click',
          image: 'img_0123456789',
          imageAlt: 'Pack',
          regions: [{ code: 1, label: 'Logo', x: 1, y: 2, w: 30.5, h: 10 }],
        },
        { id: 'NOTE', type: 'info', text: 'Thanks so far' },
      ],
    },
    { id: 'L1', questions: [{ id: 'RATE', type: 'scale', text: 'Rate {{BRAND}}', min: 1, max: 5 }] },
  ],
  variables: [{ id: 'ADULT', expr: 'AGE >= 18', label: 'Adult' }],
  loops: [{ id: 'BRAND', pages: ['L1'], source: 'AWARE' }],
  blocks: [],
  terminations: [{ id: 'T1', condition: 'AGE < 18', status: 'terminate', label: 'Minor' }],
  quotas: [{ id: 'QA', condition: 'AGE < 35', target: 50 }],
  settings: {
    allowBack: true,
    quality: { countries: ['GB', 'US'], checks: [{ id: 'ATTN', condition: 'AGE == 1', weight: 30 }] },
    capi: { gps: 'optional', audio: 'consent', consentText: 'May I?' },
  },
});

describe('ZAPX XML', () => {
  it('round-trips the whole definition', () => {
    const xml = toZapxXml(full);
    expect(xml).toContain('<hotspot id="SPOT"');
    expect(xml).toContain('&amp; &quot;health&quot; &lt;tracker&gt;');
    const back = fromZapxXml(xml);
    expect(back.warnings).toEqual([]);
    const parsed = parseSurveyDefinition(back.definition);
    expect(parsed.ok && parsed.definition).toEqual(full);
  });

  it('reports unknown elements and attributes with their line', () => {
    const xml = toZapxXml(full)
      .replace('<single id="BEST"', '<single id="BEST" colour="red"')
      .replace('</survey>', '  <exec>print(1)</exec>\n</survey>');
    const r = fromZapxXml(xml);
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringContaining('"colour"'), expect.stringContaining('<exec>')]);
    expect(r.warnings[1]!.line).toBeGreaterThan(r.warnings[0]!.line);
  });

  it('rejects unsafe or broken documents', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><survey/>')).toThrow(XmlError);
    expect(() => parseXml('<survey>&ext;</survey>')).toThrow(/Unknown entity/);
    expect(() => parseXml('<survey>\n<page>\n</survey>')).toThrow(/line 2/);
    expect(parseXml('<a x="1 &lt; 2"><![CDATA[<b>]]></a>').children[0]).toMatchObject({ text: '<b>' });
  });
});

describe('Decipher-style XML migration', () => {
  const decipher = `<survey alt="Healthcare HCP study">
  <radio label="S1" optional="0">
    <title>What is your specialty?</title>
    <row label="r1">Cardiology</row>
    <row label="r2">Oncology</row>
    <row label="r3" value="99" exclusive="1">Other</row>
  </radio>
  <term cond="S1.r3">Not a target specialty</term>
  <suspend/>
  <checkbox label="Q2" atleast="1" shuffle="rows" cond="S1.r1 or S1.r2">
    <title>Which treatments do you prescribe?</title>
    <comment>Select all that apply</comment>
    <row label="r1">Treatment A</row>
    <row label="r2" open="1">Other</row>
  </checkbox>
  <radio label="Q3">
    <title>Rate each</title>
    <row label="r1">Efficacy</row>
    <col label="c1">Low</col>
    <col label="c2">High</col>
  </radio>
  <number label="Q4" verify="range(0,60)"><title>Years in practice</title></number>
  <text label="Q5" cond="Q2.r1 and Q4.r1"><title>Why?</title></text>
  <exec>p.score = 1</exec>
  <html label="END">Thank you <b>doctor</b></html>
</survey>`;

  it('converts structure and simple conditions, and lists the rest', () => {
    const r = fromDecipherStyleXml(decipher);
    const parsed = parseSurveyDefinition(r.definition);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const def = parsed.definition;
    expect(def.title).toBe('Healthcare HCP study');
    expect(def.pages.map((p) => p.questions.map((q) => `${q.id}:${q.type}`))).toEqual([
      ['S1:single'],
      ['Q2:multi', 'Q3:grid', 'Q4:numeric', 'Q5:open', 'END:info'],
    ]);
    const q2 = def.pages[1]!.questions[0]!;
    expect(q2.condition).toBe('S1 == 1 or S1 == 2');
    expect(q2.type === 'multi' && q2.randomize && q2.minSelected).toBe(1);
    expect(def.terminations[0]!.condition).toBe('S1 == 99');
    const q4 = def.pages[1]!.questions[2]!;
    expect(q4.type === 'numeric' && [q4.min, q4.max]).toEqual([0, 60]);
    expect(def.pages[1]!.questions[4]!.text).toBe('Thank you doctor');
    const messages = r.warnings.map((w) => w.message).join('\n');
    expect(messages).toMatch(/please specify/);
    expect(messages).toMatch(/Python code/);
    expect(messages).toMatch(/"Q2.r1 and Q4.r1" could not be converted/);
    expect(r.converted).toMatchObject({ questions: 6, pages: 2, terminations: 1 });
    expect(analyzeSurvey(def).ok).toBe(true);
  });
});
