# Going live: what needs a person with the accounts

Everything in ZAPX that could be built and tested without real accounts is done: milestones 1 to
20 are merged into `main`, and the rest is in the open pull requests listed in
[merge-order.md](merge-order.md) (the design system, the blueprint phases, the handbook, the security
fixes, webcam eye tracking and integrations in the CRM). The steps below need credentials, accounts or
decisions that only the owner has. Do them on a **staging** stack first, in this order; each links to
the guide with the details.

| #   | Step                                                                                                     | Needs                                  | Guide                                                        |
| --- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| 1   | Review and merge the open pull requests in the order in [merge-order.md](merge-order.md)                 | GitHub                                 | [merge-order.md](merge-order.md)                             |
| 2   | Create the Terraform state bucket, ACM certificates (one in us-east-1) and DNS validation                | AWS account, DNS for the domains       | [infra/terraform/README.md](../../infra/terraform/README.md) |
| 3   | `terraform apply` with `waf_mode = "count"`, then put the app secret JSON in Secrets Manager             | AWS                                    | same                                                         |
| 4   | First release: `ENVIRONMENT=staging infra/scripts/deploy-aws.sh` (Docker and the AWS CLI on the PC)      | AWS                                    | same                                                         |
| 5   | Create the first organization (temporary `ALLOW_SIGNUP = "true"`, then remove it)                        | —                                      | same                                                         |
| 6   | In the CRM, **Settings → Integrations**: connect Claude, then IPinfo, Deepgram, Twilio, Stripe as needed | The provider accounts                  | [below](#integrations-are-set-up-in-the-crm)                 |
| 7   | Run `scripts/projexa-check.mjs` against the deployed PROJEXA                                             | A deployed PROJEXA and its client keys | [redirects.md](../modules/redirects.md)                      |
| 8   | Connect your real identity provider (OpenID Connect or SAML) and, if wanted, SCIM, in Settings           | IdP admin (Entra ID, Okta, Google)     | [sso-scim-plans.md](../modules/sso-scim-plans.md)            |
| 9   | Read a week of WAF logs from real fieldwork, then set `waf_mode = "block"`                               | AWS                                    | [infra/terraform/README.md](../../infra/terraform/README.md) |
| 10  | Restore test: restore the database and a file from AWS Backup into a scratch stack                       | AWS                                    | [database.md](database.md)                                   |
| 11  | Production stack: repeat 2 to 6 with `environment = "production"` and `db_multi_az = true`               | AWS                                    | same                                                         |

## Integrations are set up in the CRM

Every third-party service is connected from inside ZAPX, not by editing server settings. An
administrator of the organization that runs the installation (the first organization created; hand
it over with `node apps/api/dist/cli/set-operator.js <member email>`) opens **Settings →
Integrations**, pastes the key, presses **Test connection**, ticks **Turn on** and saves. The change
reaches every server and the background worker within 15 seconds, with no restart or redeploy.

| Integration | What it needs                                                                         | Where to get it                                                       |
| ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Claude      | API key and model (e.g. `claude-opus-5-5`); optional per-task models and prices       | console.anthropic.com → API keys                                      |
| IPinfo      | Access token on a plan with privacy detection                                         | ipinfo.io → Token                                                     |
| Deepgram    | API key and model (e.g. `nova-3`)                                                     | console.deepgram.com → API keys                                       |
| Twilio      | Account SID, auth token, a voice number; the callback address defaults to studio      | console.twilio.com → Account info, Phone numbers                      |
| Stripe      | Secret key, webhook signing secret, plan prices (`{"team":"price_..."}`)              | dashboard.stripe.com → Developers; add the webhook URL the page shows |
| Amazon S3   | Bucket and region (on AWS the stack already sets these); access keys only outside AWS | Terraform output, or the S3 console                                   |

How it is kept safe:

- Keys are encrypted (AES-256-GCM) with `SECRETS_KEY` before they reach the database, and the page
  never shows them again, only their last four characters.
- Only administrators of the operator organization can open the page, only when signed in (not with
  an API key). Customer organizations never see it.
- Every save, test and reset is in the audit log (Settings → Audit log), saying which fields changed
  but never their values.
- The test calls go only to each provider's fixed address, so the page cannot be used to reach other
  servers.
- Anything saved in the CRM wins over the server environment, and a field left empty falls back to
  it. **Use server settings instead** forgets what was saved. Existing environment variables keep
  working, so nothing breaks on upgrade.

Set up per organization (each customer connects its own, on the main Settings page): single sign-on
(OIDC and SAML), SCIM, webhooks, API keys and AI limits. PROJEXA and other sample vendors are set up
per project under Vendors.

## What still needs a developer

These protect or run the server itself, so they cannot be changed from a web page. They are set once
when the stack is deployed (steps 2 to 4) and rarely again:

- **Master keys:** `JWT_SECRET` (sign-in sessions) and `SECRETS_KEY` (encrypts every key saved in
  the CRM). Changing `SECRETS_KEY` means entering the integration keys again.
- **Database:** `DATABASE_URL`, or the RDS parts Terraform passes in.
- **Addresses and HTTPS:** `STUDIO_URL`, `RUNTIME_BASE_URL`, `CAPI_APP_URL`, `COOKIE_SECURE`, DNS and
  certificates.
- **AWS resources (Terraform):** servers, load balancer, CloudFront, WAF, backups, the KMS key and the
  S3 bucket itself, and the IAM role that lets the servers use that bucket.
- **Edge and proxies:** `EDGE_SHARED_SECRET`, `TRUST_PROXY_HOPS`, `GEO_COUNTRY_HEADER`.
- **Where work runs:** `JOB_WORKER`, `CALLBACK_WORKER` and the worker service; size limits and
  retention (`UPLOAD_MAX_MB`, `CAPTURE_RETENTION_DAYS` and similar).
- **Sign-up:** `ALLOW_SIGNUP` and `DEFAULT_PLAN`.
- **Email, SMS and residency:** `EMAIL_PROVIDER` and `SENDGRID_API_KEY` (invitations, password
  resets), `SMS_PROVIDER` and `SMS_FROM` (SMS invitations; the Twilio account comes from the Twilio
  integration), and `DATA_REGION` (the region this deployment declares for data residency).

## What to watch on staging

These parts were tested only against stand-ins, so they are the most likely to need adjustment:

- **S3** (tested against a fake S3): an export download, a media upload and a CAPI photo.
- **SAML and OpenID Connect** (tested against test identity providers): one sign-in per provider,
  from a private window, with an administrator keeping a password.
- **Stripe** (tested against a fake Stripe): one Checkout in test mode, one cancellation in the
  portal, and the webhook log in the Stripe dashboard showing 200 answers.
- **Terraform** (validated and plan-tested with a mocked provider): the first apply. AWS Backup of
  the files bucket and the KMS key permissions it needs are the parts most likely to need a fix.
- **WAF** (count mode first): CAPI sync, large exports and question text with HTML are the likely
  false positives; three of them are already count-only (`waf_count_only_rules`).
- **IPinfo, Deepgram and Twilio** (each tested against a local stand-in): one interview from a VPN,
  one transcript, and one dialled call with recording to your own two phones, from a Twilio trial.
- **Test connection** on each integration was tested against stand-ins too: the first real key for
  each provider is the check that its answers are read correctly.
- **PROJEXA**: tested against PROJEXA's code run locally. Separate PROJEXA finding: a duplicate
  client code on `POST /api/v1/clients` answers 500 instead of 409.

## Product gaps that need a provider or a decision

Not built because each needs a third-party service or a product decision:

- Voice-over per language (a text-to-speech provider) and transcription of typed open answers.
- Predictive dialing, answering-machine detection and an in-browser softphone for CATI.
- Nets, banner books and PowerPoint in analysis; hierarchical Bayes estimation for MaxDiff and conjoint
  (both are built with whole-sample estimation).
- Webcam eye tracking is built as an experimental, opt-in task, but it has not been validated on real
  webcams; test it with a few real respondents before selling it (ADR 0034).
- Seat-based or usage-based billing; SAML single logout and encrypted assertions.
