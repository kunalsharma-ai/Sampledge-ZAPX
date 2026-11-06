/**
 * Server side of the SampCode mobile app: server identification and minimum app version, the mobile
 * settings, the new token after a password change, and the mobile feature set for a Bearer client.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.LOGIN_RATE_PER_MINUTE = '100';
  process.env.MOBILE_MIN_VERSION = '1.0.0';
});

import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { resetConfig } from '../src/config';

const run = `mob${Date.now().toString(36)}`;
const password = 'correct-horse-battery';
let app: INestApplication;
let http: ReturnType<typeof request>;
let token: string;

beforeAll(async () => {
  resetConfig();
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(mod.createNestApplication());
  await app.init();
  http = request(app.getHttpServer());
  const reg = await http
    .post('/api/auth/register')
    .send({ organization: `Org ${run}`, name: 'Admin', email: `admin-${run}@test.zapx`, password })
    .expect(201);
  token = reg.body.token;
});

afterAll(async () => {
  await app?.close();
});

describe('mobile app endpoints', () => {
  it('identifies the server without signing in', async () => {
    const r = await http.get('/api/mobile/version').expect(200);
    expect(r.body).toEqual({ service: 'zapx', minimumAppVersion: '1.0.0' });
  });

  it('gives signed-in members the CAPI and runtime addresses', async () => {
    await http.get('/api/mobile/config').expect(401);
    const r = await http
      .get('/api/mobile/config')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(r.body.capiAppUrl).toMatch(/^https?:\/\//);
    expect(r.body.runtimeBaseUrl).toMatch(/^https?:\/\//);
  });

  it('answers the mobile feature set to a Bearer client, without web-only features', async () => {
    const r = await http
      .get('/api/me/entitlements?surface=mobile')
      .set({ Authorization: `Bearer ${token}`, 'X-ZAPX-Client': 'mobile' })
      .expect(200);
    expect(r.body.surface).toBe('mobile');
    expect(r.body.features.webhooks).toBe(false);
    expect(r.body.features.api_keys).toBe(false);
    expect(typeof r.body.version).toBe('string');
  });

  it('returns a fresh token after a password change, and the old one stops working', async () => {
    const old = { Authorization: `Bearer ${token}` };
    const r = await http
      .post('/api/auth/change-password')
      .set(old)
      .send({ currentPassword: password, newPassword: 'another-long-password-9' })
      .expect(200);
    expect(typeof r.body.token).toBe('string');
    await http
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${r.body.token}` })
      .expect(200);
    await http.get('/api/auth/me').set(old).expect(401);
  });
});
