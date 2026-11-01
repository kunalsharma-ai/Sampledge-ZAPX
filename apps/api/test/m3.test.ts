/**
 * Milestone 3: themes, translations (AI-assisted, human-reviewed) and device rules, through the API
 * and the respondent flow. The AI provider is a scripted fake.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AiProvider, type TranslateRequest, type TranslateResult } from '../src/ai/ai-provider';

process.env.ALLOW_SIGNUP = 'true';
const demo = JSON.parse(readFileSync(join(__dirname, '../../../docs/examples/demo-screener.json'), 'utf8'));
const run = `m3${Date.now().toString(36)}`;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';

class FakeTranslator extends AiProvider {
  readonly configured = true;
  readonly model = 'fake-translator';
  requests: TranslateRequest[] = [];
  architect(): Promise<never> {
    throw new Error('not used');
  }
  async translate(req: TranslateRequest): Promise<TranslateResult> {
    this.requests.push(req);
    // Keeps {{piping}} and {n}-style placeholders, like a careful translator.
    return { model: this.model, translations: Object.fromEntries(req.items.map((i) => [i.key, `FR ${i.text}`])) };
  }
}

const fake = new FakeTranslator();
let app: INestApplication;
let http: ReturnType<typeof request>;
let auth: Record<string, string>;
let surveyId: string;
let updatedAt: string;

async function draft() {
  const d = (await http.get(`/api/surveys/${surveyId}/draft`).set(auth).expect(200)).body;
  updatedAt = d.version.updatedAt;
  return d;
}

async function savePresentation(presentation: unknown, expect = 200) {
  const res = await http
    .put(`/api/surveys/${surveyId}/draft/presentation`)
    .set(auth)
    .send({ presentation, expectedUpdatedAt: updatedAt })
    .expect(expect);
  if (expect === 200) updatedAt = res.body.version.updatedAt;
  return res.body;
}

async function testLink() {
  return (await http.post(`/api/surveys/${surveyId}/links`).set(auth).send({ test: true }).expect(201)).body.url as string;
}

async function start(url: string, headers: Record<string, string> = {}, extra: Record<string, string> = {}, client?: unknown) {
  const u = new URL(url);
  const query = { ...Object.fromEntries(u.searchParams), ...extra };
  return (
    await http
      .post(`/api/public/s/${surveyId}/start`)
      .set({ 'User-Agent': DESKTOP, ...headers })
      .send({ query, client })
      .expect(200)
  ).body;
}

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiProvider)
    .useValue(fake)
    .compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  const res = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Prog', email: `prog-${run}@test.zapx`, password: 'correct-horse-battery' })
    .expect(201);
  auth = { Authorization: `Bearer ${res.body.token}` };
  const projectId = (await http.post('/api/projects').set(auth).send({ name: 'M3' }).expect(201)).body.id;
  surveyId = (await http.post(`/api/projects/${projectId}/surveys`).set(auth).send({ name: 'M3 survey' }).expect(201)).body.id;
  await http.put(`/api/surveys/${surveyId}/draft`).set(auth).send({ definition: demo }).expect(200);
  await draft();
});

afterAll(async () => {
  await app?.close();
});

describe('Experience: themes', () => {
  it('saves a theme and rejects unsafe or invalid values', async () => {
    const saved = await savePresentation({
      theme: {
        preset: 'warm',
        accent: '#c2410c',
        font: 'rounded',
        radius: 18,
        motion: 'lively',
        logo: 'data:image/png;base64,iVBORw0KGgo=',
      },
    });
    expect(saved.version.presentation.theme.accent).toBe('#c2410c');
    expect(saved.version.presentation.devices.allowed).toEqual(['desktop', 'tablet', 'mobile']);
    const bad = await savePresentation({ theme: { logo: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=' } }, 400);
    expect(bad.issues[0].path).toBe('theme.logo');
    await http
      .put(`/api/surveys/${surveyId}/draft/presentation`)
      .set(auth)
      .send({ presentation: {}, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' })
      .expect(409);
  });
});

describe('Languages', () => {
  it('blocks publishing while an offered language is incomplete', async () => {
    const current = (await draft()).version.presentation;
    await savePresentation({ ...current, sourceLanguageName: 'English', languages: [{ tag: 'fr', name: 'Français', enabled: true }] });
    const d = await draft();
    expect(d.check.publishable).toBe(false);
    expect(d.check.languageBlockers[0]).toContain('Français (fr)');
    const res = await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(422);
    expect(res.body.message).toContain('Finish the translations');
  });

  it('AI translation fills missing texts as machine translations that still need review', async () => {
    const res = (await http.post(`/api/surveys/${surveyId}/translate`).set(auth).send({ language: 'fr' }).expect(201)).body;
    expect(res.requested).toBeGreaterThan(20);
    expect(res.translated).toBe(res.requested);
    expect(fake.requests[0]!.to).toEqual({ tag: 'fr', name: 'Français' });
    const fr = res.version.presentation.languages[0];
    expect(fr.texts['q.AGE.text'].status).toBe('machine');
    expect(res.check.publishable).toBe(false);
    expect(res.check.translations[0].unreviewed.length).toBe(res.requested);
    // Nothing left to translate.
    const again = (await http.post(`/api/surveys/${surveyId}/translate`).set(auth).send({ language: 'fr' }).expect(201)).body;
    expect(again.requested).toBe(0);
  });

  it('publishes once a person has reviewed every translation', async () => {
    const d = await draft();
    const pres = d.version.presentation;
    for (const e of Object.values(pres.languages[0].texts) as Array<{ status: string }>) e.status = 'reviewed';
    pres.languages[0].texts['ui.required'].text = 'Réponse obligatoire.';
    const saved = await savePresentation(pres);
    expect(saved.check.publishable).toBe(true);
    await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
  });

  it('serves the respondent in the chosen language and lets them switch', async () => {
    const url = await testLink();
    const fr = await start(url, {}, { lang: 'fr' });
    expect(fr.state).toBe('in_progress');
    expect(fr.look.language).toBe('fr');
    expect(fr.look.languages).toEqual([
      { tag: 'en', name: 'English' },
      { tag: 'fr', name: 'Français' },
    ]);
    expect(fr.look.ui.next).toBe('FR Next');
    expect(fr.look.theme.accent).toBe('#c2410c');
    expect(fr.page.questions[0].renderedText.startsWith('FR ')).toBe(true);
    // Answer codes are unchanged.
    const gender = fr.page.questions.find((q: { id: string }) => q.id === 'GENDER');
    expect(gender.options.map((o: { code: number }) => o.code)).toEqual(
      demo.pages[0].questions[1].options.map((o: { code: number }) => o.code),
    );
    const invalid = await http.post(`/api/public/r/${fr.token}/answers`).send({ pageId: fr.page.id, answers: {} }).expect(422);
    expect(invalid.body.errors[0].message).toBe('Réponse obligatoire.');

    const en = (await http.post(`/api/public/r/${fr.token}/language`).send({ language: 'en' }).expect(200)).body;
    expect(en.page.questions[0].renderedText).toBe(demo.pages[0].questions[0].text);
    await http.post(`/api/public/r/${fr.token}/language`).send({ language: 'de' }).expect(404);
  });

  it('uses the browser language when no language is requested', async () => {
    const s = await start(await testLink(), { 'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.5' });
    expect(s.look.language).toBe('fr');
    const d = await start(await testLink(), { 'Accept-Language': 'de-DE' });
    expect(d.look.language).toBe('en');
  });
});

describe('Devices', () => {
  it('screens out devices that are not allowed, without creating a response', async () => {
    const d = await draft();
    await savePresentation({ ...d.version.presentation, devices: { allowed: ['desktop'], gridOnMobile: 'scroll' } });
    await http.post(`/api/surveys/${surveyId}/publish`).set(auth).expect(201);
    const before = (await http.get(`/api/surveys/${surveyId}/responses?includeTest=true`).set(auth).expect(200)).body.length;

    const phone = await start(await testLink(), { 'User-Agent': IPHONE, 'Accept-Language': 'en' });
    expect(phone.state).toBe('finished');
    expect(phone.status).toBe('terminate');
    expect(phone.message).toBe('This survey cannot be taken on this device. Please open the link on a computer.');
    const ipad = await start(
      await testLink(),
      { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15' },
      {},
      { touch: true },
    );
    expect(ipad.state).toBe('finished');

    const desk = await start(await testLink(), { 'Accept-Language': 'en' });
    expect(desk.state).toBe('in_progress');
    expect(desk.look.gridOnMobile).toBe('scroll');
    const after = (await http.get(`/api/surveys/${surveyId}/responses?includeTest=true`).set(auth).expect(200)).body;
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ device: 'desktop', language: 'en' });
  });

  it('exports language and device columns', async () => {
    const csv = (await http.get(`/api/surveys/${surveyId}/export?format=csv&includeTest=true`).set(auth).expect(200)).text;
    const header = csv.split('\n')[0]!;
    expect(header).toContain('language');
    expect(header).toContain('device');
    expect(csv).toContain(',fr,desktop,');
  });
});
