# Webhooks (Milestone 6)

Settings → Webhooks (admins). SampCode sends a JSON `POST` to your endpoint when something happens.

## Events

| Event                     | When                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `response.finished`       | A respondent (online) or CAPI interview reaches an outcome               |
| `response.review_decided` | A complete is accepted or rejected in the quality review queue           |
| `survey.published`        | A new survey version is published                                        |
| `survey.status_changed`   | A survey goes live, is paused or closed                                  |
| `webhook.test`            | "Send test event" in the studio (always sent, whatever you subscribe to) |

Test respondents never produce events. A complete that is later rejected in review sends
`response.review_decided` (decision `rejected`, status `quality_fail`), not a second
`response.finished`.

## Request

```http
POST /your/endpoint
Content-Type: application/json
X-Zapx-Event: response.finished
X-Zapx-Delivery: 0f8c4f0e-3a55-4b7e-9d0b-6c6f3c3a2f11
X-Zapx-Signature: t=1793611200,v1=5d2c...hex...

{
  "id": "0f8c4f0e-3a55-4b7e-9d0b-6c6f3c3a2f11",
  "type": "response.finished",
  "createdAt": "2026-11-02T10:00:00.000Z",
  "data": {
    "responseId": "cmh...",
    "surveyId": "cmh...",
    "projectId": "cmh...",
    "status": "complete",
    "mode": "CAWI",
    "vendor": "SE",
    "uid": "SE-1001",
    "qualityScore": 95,
    "reviewState": "NONE",
    "finishedAt": "2026-11-02T09:59:58.000Z"
  }
}
```

`status` is one of complete, terminate, quota_full, quality_fail, security_reject, duplicate, partial,
technical_error. Payloads never include answers; fetch data with an API key and the export endpoint.

## Verifying the signature

The secret (`whsec_...`) is shown once when you add the webhook and when you rotate it. Verify over
the raw request body, compare in constant time and reject old timestamps:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(secret, rawBody, header, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## Delivery

- Answer with any 2xx within 10 seconds (`CALLBACK_TIMEOUT_MS`). 408, 429, 5xx and network errors are
  retried up to 6 attempts with exponential backoff (30 s doubling, up to an hour, with jitter); other
  4xx fail at once.
- Delivery is at least once and not ordered. Deduplicate by `X-Zapx-Delivery`; order by `createdAt`.
- The studio shows the last 50 deliveries per webhook with their result, and failed ones can be
  redelivered. Paused webhooks get no new events.
- Endpoints must use `https://`, and must resolve to public addresses (the same SSRF guard as vendor
  callbacks). Redirects are not followed.

API (admins, session only): `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/:id`,
`POST /api/webhooks/:id/test`, `POST /api/webhooks/:id/rotate-secret`,
`GET /api/webhooks/:id/deliveries`, `POST /api/webhook-deliveries/:id/redeliver`,
`GET /api/webhook-events`.
