/**
 * "Test connection" for each platform integration: one cheap, read-only call that proves the key works.
 * The provider addresses come from the environment (they only change for tests), never from the
 * browser, so this cannot be used to make the server call arbitrary addresses.
 */
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';
import type { IntegrationKey } from './integrations';

export interface CheckResult {
  ok: boolean;
  message: string;
}

const TIMEOUT_MS = 10_000;

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

const base = (u: string) => u.replace(/\/$/, '');
const refused = (who: string, status: number) =>
  status === 401 || status === 403
    ? `${who} rejected the credentials (HTTP ${status}). Check the key and paste it again.`
    : `${who} answered HTTP ${status}.`;
const errorText = (body: Record<string, unknown>) => {
  const e = body.error as { message?: string } | string | undefined;
  return typeof e === 'string' ? e : (e?.message ?? (body.message as string | undefined) ?? '');
};

type Checker = (v: Record<string, string>) => Promise<CheckResult>;

const CHECKS: Record<IntegrationKey, Checker> = {
  async anthropic(v) {
    const models = [...new Set([v.model, v.modelArchitect, v.modelTranslate].filter(Boolean))];
    for (const model of models) {
      const r = await call(`${base(config().ANTHROPIC_API_BASE)}/v1/models/${encodeURIComponent(model!)}`, {
        headers: { 'x-api-key': v.apiKey!, 'anthropic-version': '2023-06-01' },
      });
      if (r.status === 404) return { ok: false, message: `The key works, but the model "${model}" does not exist for this account.` };
      if (r.status !== 200) return { ok: false, message: refused('Anthropic', r.status) };
    }
    return { ok: true, message: `Connected. Model${models.length > 1 ? 's' : ''} ${models.join(', ')} available.` };
  },

  async ipinfo(v) {
    // A well-known public address; the answer is thrown away.
    const r = await call(`${base(config().IPINFO_API_BASE)}/8.8.8.8/privacy`, {
      headers: { Authorization: `Bearer ${v.token}`, Accept: 'application/json' },
    });
    if (r.status === 200 && typeof r.body.vpn === 'boolean')
      return { ok: true, message: 'Connected. Privacy detection is included in the plan.' };
    if (r.status === 200 || r.status === 403)
      return { ok: false, message: 'The token works, but this IPinfo plan does not include privacy detection.' };
    return { ok: false, message: refused('IPinfo', r.status) };
  },

  async deepgram(v) {
    const r = await call(`${base(config().DEEPGRAM_API_BASE)}/v1/projects`, { headers: { Authorization: `Token ${v.apiKey}` } });
    if (r.status !== 200) return { ok: false, message: refused('Deepgram', r.status) };
    return { ok: true, message: `Connected. Transcripts will use the model "${v.model}".` };
  },

  async twilio(v) {
    const auth = `Basic ${Buffer.from(`${v.accountSid}:${v.authToken}`).toString('base64')}`;
    const r = await call(`${base(config().TWILIO_API_BASE)}/2010-04-01/Accounts/${encodeURIComponent(v.accountSid!)}.json`, {
      headers: { Authorization: auth },
    });
    if (r.status !== 200) return { ok: false, message: refused('Twilio', r.status) };
    if (r.body.status && r.body.status !== 'active') return { ok: false, message: `The Twilio account is ${String(r.body.status)}.` };
    const n = await call(
      `${base(config().TWILIO_API_BASE)}/2010-04-01/Accounts/${encodeURIComponent(v.accountSid!)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(v.callerId!)}`,
      { headers: { Authorization: auth } },
    );
    const own = Array.isArray(n.body.incoming_phone_numbers) && n.body.incoming_phone_numbers.length > 0;
    return {
      ok: true,
      message: own
        ? `Connected. ${v.callerId} is a number on this account.`
        : `Connected. ${v.callerId} is not a number on this account; it works only if it is a verified caller ID in Twilio.`,
    };
  },

  async stripe(v) {
    const headers = { Authorization: `Bearer ${v.secretKey}`, ...(v.apiVersion ? { 'Stripe-Version': v.apiVersion } : {}) };
    const prices = Object.entries(JSON.parse(v.prices || '{}') as Record<string, string>);
    for (const [plan, price] of prices) {
      const r = await call(`${base(config().STRIPE_API_BASE)}/v1/prices/${encodeURIComponent(price)}`, { headers });
      if (r.status === 404)
        return { ok: false, message: `The key works, but the price for "${plan}" (${price}) does not exist in Stripe.` };
      if (r.status !== 200) return { ok: false, message: `${refused('Stripe', r.status)} ${errorText(r.body)}`.trim() };
      if (r.body.active === false) return { ok: false, message: `The price for "${plan}" (${price}) is archived in Stripe.` };
    }
    const live = v.secretKey!.includes('_live_');
    return {
      ok: true,
      message: `Connected to Stripe in ${live ? 'live' : 'test'} mode. ${prices.length} plan price${prices.length === 1 ? '' : 's'} found. The webhook secret is checked when Stripe sends its first event.`,
    };
  },

  async s3(v) {
    const c = config();
    const client = new S3Client({
      region: v.region,
      ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT, forcePathStyle: true } : {}),
      ...(v.accessKeyId && v.secretAccessKey ? { credentials: { accessKeyId: v.accessKeyId, secretAccessKey: v.secretAccessKey } } : {}),
      maxAttempts: 1,
    });
    try {
      await client.send(new HeadBucketCommand({ Bucket: v.bucket }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
      return { ok: true, message: `Connected. The bucket ${v.bucket} is reachable.` };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return { ok: false, message: `There is no bucket called ${v.bucket} in ${v.region}.` };
      if (status === 403) return { ok: false, message: `Access to ${v.bucket} was denied. Check the keys or the server's AWS role.` };
      return { ok: false, message: `Could not reach S3: ${(e as Error).message}` };
    } finally {
      client.destroy();
    }
  },
};

export async function checkIntegration(key: IntegrationKey, values: Record<string, string>): Promise<CheckResult> {
  try {
    return await CHECKS[key](values);
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      message: err.name === 'TimeoutError' ? 'The provider did not answer within 10 seconds.' : `Could not connect: ${err.message}`,
    };
  }
}
