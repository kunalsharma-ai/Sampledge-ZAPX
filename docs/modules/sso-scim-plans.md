# Single sign-on, SCIM and plans (Milestone 8)

Design and trade-offs: [ADR 0014](../adr/0014-sso-scim-and-plans.md).

> **Tested with a mock provider only.** The flow is covered by API and browser tests against a local
> OpenID Connect mock (`apps/api/test/support/mock-oidc.ts`). Sign in once through your real
> provider before you rely on it, and keep an admin password.

## Single sign-on (OpenID Connect)

1. At your identity provider, register a **web application** (confidential client) with:
   - Redirect URI: `${STUDIO_URL}/api/auth/sso/callback` (shown in Settings → Single sign-on).
   - Scopes: `openid email profile`. Client authentication: client secret sent in the request body
     (`client_secret_post`).
2. In SampCode, Settings → Single sign-on: issuer URL, client ID, client secret, and the email domains
   that belong to your organization. Saving checks the provider's discovery document.
3. Choose what happens to people who sign in without a SampCode account: refuse, or create them as
   viewers, programmers or interviewers (never admins).
4. Optionally **require single sign-on**: everyone except admins must use it.

People sign in by typing their work email and choosing **Sign in with SSO**.

| Provider           | Issuer URL                                                       |
| ------------------ | ---------------------------------------------------------------- |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0`             |
| Okta               | `https://<your-org>.okta.com` (or a custom authorization server) |
| Google Workspace   | `https://accounts.google.com`                                    |
| Keycloak           | `https://<host>/realms/<realm>`                                  |

These are the providers' documented issuer formats; none has been tried with SampCode yet.

Rules SampCode applies: PKCE, `state` and `nonce` are checked; the ID token must be signed by the
provider's published keys for this client; the email must be in your domains and not marked
unverified; an email that belongs to another SampCode organization is refused; disabled members are
refused. The member is linked to the provider's `sub` on first sign-in.

## Disabling members

Settings → Team → Disable. The member is signed out at once, their API keys stop working, and they
cannot sign in by password or SSO. Their history stays. Enable brings them back (if the plan has a
seat).

## SCIM 2.0 provisioning

Settings → SCIM provisioning → Create SCIM token. Give your identity provider:

- Base URL: `${STUDIO_URL}/api/scim/v2`
- Authentication: Bearer token (the `scim_...` token, shown once)

Supported: `GET /Users` (filters `userName eq`, `externalId eq`, `emails eq`, paging with
`startIndex` and `count`), `POST /Users`, `GET/PUT/PATCH/DELETE /Users/{id}`,
`/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas`.

| SCIM attribute                | SampCode                                                          |
| ----------------------------- | ----------------------------------------------------------------- |
| `userName` (or primary email) | email (sign-in name)                                              |
| `displayName` or `name`       | name                                                              |
| `externalId`                  | kept as the provider's id                                         |
| `active`                      | false disables the member                                         |
| `roles[].value`               | `admin`, `programmer`, `viewer` or `interviewer` (viewer if none) |
| `DELETE /Users/{id}`          | disables the member (the account and its history are kept)        |

Not supported: groups, bulk, sorting, ETags, password changes. Members created by SCIM have no
usable password and sign in with SSO. Every change is in the audit log as `scim.*`.

## Plans and limits

| Plan       | Team members | Interviewers | Live surveys | Completes per month | SSO | SCIM |
| ---------- | ------------ | ------------ | ------------ | ------------------- | --- | ---- |
| Free       | 3            | 2            | 2            | 250                 | no  | no   |
| Team       | 10           | 10           | 10           | 5,000               | no  | no   |
| Business   | 50           | 100          | 50           | 50,000              | yes | no   |
| Enterprise | unlimited    | unlimited    | unlimited    | unlimited           | yes | yes  |

- Only active members count; interviewers have their own allowance.
- Completes are counted per calendar month in UTC, excluding test interviews.
- At a limit: adding or re-enabling members, putting a survey live and starting new interviews are
  refused (`403`, `code: PLAN_LIMIT`). Respondents see the survey as closed and vendors get the
  quota-full redirect; people already in an interview can finish. CAPI interviews synced from the
  field are always accepted.
- Settings → Plan shows usage. `GET /api/plan` returns the same.

Operators change a plan with:

```bash
node apps/api/dist/cli/set-plan.js <member email or organization id> <free|team|business|enterprise>
```

Plan changes made with this command are recorded in the audit log as `plan.change`. New sign-ups
get `DEFAULT_PLAN` (`enterprise` by default). With billing turned on (Milestone 13, see
[billing.md](billing.md)) the organization's Stripe subscription sets the plan, and the next
subscription change overrides a manual one.

## Settings

| Setting                     | Default                 | Meaning                                                            |
| --------------------------- | ----------------------- | ------------------------------------------------------------------ |
| `STUDIO_URL`                | `http://localhost:3000` | Public studio address; used for the SSO redirect URI and SCIM URLs |
| `DEFAULT_PLAN`              | `enterprise`            | Plan for organizations created by sign-up                          |
| `SSO_ALLOW_INSECURE_ISSUER` | `false`                 | Development only: allow http and private-network providers         |

## SAML 2.0 (Milestone 13)

Choose **SAML 2.0** under Settings → Single sign-on for identity providers that use SAML (AD FS,
Entra ID, Okta, OneLogin, PingFederate). The organization's email domains, just-in-time role and
"require single sign-on" work as for OpenID Connect; an organization uses one protocol at a time.

In the identity provider, add SampCode as a SAML application:

| Setting                    | Value                                                                             |
| -------------------------- | --------------------------------------------------------------------------------- |
| Entity ID / audience       | `${STUDIO_URL}/api/auth/sso/saml/metadata`                                        |
| ACS (reply) URL, HTTP-POST | `${STUDIO_URL}/api/auth/sso/saml/acs`                                             |
| Metadata                   | `GET ${STUDIO_URL}/api/auth/sso/saml/metadata`                                    |
| Name ID                    | Persistent or email address (transient is refused)                                |
| Attributes                 | `email` (or `mail`, or the Microsoft email claim), and a display name if you like |
| Signing                    | Sign the assertion (RSA-SHA256)                                                   |

Then enter the provider's sign-in URL, its entity ID and its signing certificate in SampCode. During a
certificate rotation paste both certificates; either is accepted until you remove the old one.

What SampCode checks on every response: the assertion is signed by one of the configured certificates,
its issuer is the configured entity ID, the audience is SampCode, the timestamps are current (60 s of
clock skew), and it answers a sign-in SampCode started in the last 10 minutes. Each sign-in request can
be answered once, so a captured response cannot be replayed. Sign-ins started at the identity
provider's portal (IdP-initiated) are refused: start from the SampCode login page or link to
`/login`. Not supported yet: single logout, encrypted assertions and signed AuthnRequests.

**Tested** against a test identity provider in the API tests and in the browser
(`e2e/tests/milestone13.spec.ts`), **not yet against a real one**. Sign in once through your
provider from a private window before you turn on "require single sign-on".
