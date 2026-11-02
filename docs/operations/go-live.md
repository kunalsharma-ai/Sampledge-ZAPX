# Going live: what needs a person with the accounts

Everything in ZAPX that could be built and tested without real accounts is done (milestones 1 to
19). The steps below need credentials, accounts or decisions that only the owner has. Do them on a
**staging** stack first, in this order; each links to the guide with the details.

| #   | Step                                                                                                | Needs                                  | Guide                                                        |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------ |
| 1   | Review and merge the milestone pull requests (#1 to #19, stacked: merge in order)                   | GitHub                                 | [ADR 0009](../adr/0009-local-quality-gates.md)               |
| 2   | Create the Terraform state bucket, ACM certificates (one in us-east-1) and DNS validation           | AWS account, DNS for the domains       | [infra/terraform/README.md](../../infra/terraform/README.md) |
| 3   | `terraform apply` with `waf_mode = "count"`, then put the app secret JSON in Secrets Manager        | AWS                                    | same                                                         |
| 4   | First release: `ENVIRONMENT=staging infra/scripts/deploy-aws.sh` (Docker and the AWS CLI on the PC) | AWS                                    | same                                                         |
| 5   | Create the first organization (temporary `ALLOW_SIGNUP = "true"`, then remove it)                   | —                                      | same                                                         |
| 6   | Add `ANTHROPIC_API_KEY` to the app secret and set `AI_MODEL`; check AI budgets in Settings → AI     | Claude API key                         | [ai-gateway.md](../modules/ai-gateway.md)                    |
| 7   | Run `scripts/projexa-check.mjs` against the deployed PROJEXA                                        | A deployed PROJEXA and its client keys | [redirects.md](../modules/redirects.md)                      |
| 8   | Connect your real identity provider (OpenID Connect or SAML) and, if wanted, SCIM                   | IdP admin (Entra ID, Okta, Google)     | [sso-scim-plans.md](../modules/sso-scim-plans.md)            |
| 9   | Optional billing: Stripe products and prices, `STRIPE_PRICES`, webhook endpoint, test mode first    | Stripe account                         | [billing.md](../modules/billing.md)                          |
| 10  | Read a week of WAF logs from real fieldwork, then set `waf_mode = "block"`                          | AWS                                    | [infra/terraform/README.md](../../infra/terraform/README.md) |
| 11  | Restore test: restore the database and a file from AWS Backup into a scratch stack                  | AWS                                    | [database.md](database.md)                                   |
| 12  | Production stack: repeat 2 to 5 with `environment = "production"` and `db_multi_az = true`          | AWS                                    | same                                                         |
| 13  | Optional VPN and data-centre check: `NETWORK_REPUTATION=ipinfo`, `IPINFO_TOKEN` (privacy plan)      | IPinfo account with privacy detection  | [data-quality.md](../modules/data-quality.md)                |
| 14  | Optional transcripts: `TRANSCRIPTION=deepgram`, `DEEPGRAM_API_KEY`, `DEEPGRAM_MODEL`                | Deepgram account                       | [data-quality.md](../modules/data-quality.md)                |
| 15  | Optional phone dialer: `TELEPHONY=twilio`, Twilio account SID, auth token, a number, webhook base   | Twilio account and a voice number      | [cati.md](../modules/cati.md)                                |

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
- **PROJEXA**: tested against PROJEXA's code run locally. Separate PROJEXA finding: a duplicate
  client code on `POST /api/v1/clients` answers 500 instead of 409.

## Product gaps that need a provider or a decision

Not built because each needs a third-party service or a product decision:

- Voice-over per language (a text-to-speech provider) and transcription of typed open answers.
- Predictive dialing, answering-machine detection and an in-browser softphone for CATI.
- Nets, banner books and PowerPoint in analysis; MaxDiff and conjoint question types.
- Seat-based or usage-based billing; SAML single logout and encrypted assertions.
