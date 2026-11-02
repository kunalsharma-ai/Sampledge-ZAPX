# 0014: Single sign-on, SCIM provisioning and plan limits

Status: Accepted (Milestone 8)

## Context

Enterprise research teams want to sign in with their company identity (Microsoft Entra ID, Okta,
Google Workspace), have leavers lose access the moment IT removes them, and have accounts created
and updated from the directory. Sampledge also needs a way to offer ZAPX to other agencies with
different allowances. There is no billing provider yet.

## Decision

- **OpenID Connect only** (no SAML). Authorization code flow with PKCE (S256), `state` and `nonce`,
  client authentication by `client_secret_post`, ID token signature checked against the provider's
  JWKS with `jose` (issuer, audience, expiry with 60 s skew, nonce). The flow's state lives in a
  signed, httpOnly, 10-minute cookie scoped to `/api/auth/sso`, so no server-side session table.
- **One provider per organization**, found from the email domain the person types. A domain can
  belong to only one organization. The provider address, discovery document and endpoints must be
  https on a public address (same SSRF rule as webhooks) unless `SSO_ALLOW_INSECURE_ISSUER=true`,
  which is refused in production. The client secret is sealed with `SecretBox` and never returned.
- **Linking accounts.** A member is found by the provider's `sub`; on first sign-in an existing
  member with the same email in the same organization is linked. An email in another organization
  is refused. New people are created only if the admin turns on just-in-time provisioning with a
  role (never admin). The email must be in the configured domains and not `email_verified: false`.
- **Enforcement.** "Require single sign-on" blocks password sign-in for everyone except admins, so
  an admin can always get back in if the provider is misconfigured or down.
- **Disabling members** (`User.disabledAt`) is the off switch for people: the guard reads it on every
  request, so sessions, API keys created by the member, and sign-in stop at once. Accounts are not
  deleted, so audit history stays attached.
- **SCIM 2.0** for users only (no groups): list with `eq` filters on userName/externalId/email,
  create, read, replace, patch (Okta and Entra ID styles, including `"Replace"` and `"False"`), and
  delete, which disables. The role comes from `roles[].value`. One bearer token per organization,
  stored as a SHA-256 hash, shown once, rotatable; requests act only on that organization.
- **Plans in code.** `free`, `team`, `business`, `enterprise` with limits on active team members,
  active interviewers, live surveys and completes per calendar month (UTC), plus whether SSO and
  SCIM are included. An organization's plan is a column set by an operator command
  (`node dist/cli/set-plan.js`), audited. Existing organizations and new sign-ups default to
  `enterprise` (unlimited) unless `DEFAULT_PLAN` says otherwise, so self-hosted installs are not
  limited by surprise.
- **What a limit does.** Adding or re-enabling a member, putting a survey live, and starting a new
  interview are refused when the limit is reached (403 with `code: PLAN_LIMIT`; respondents see
  the survey as closed). Respondents already in an interview can finish. Interviews synced from the
  offline CAPI app are always accepted, because the fieldwork already happened.

## Consequences

- SSO has been tested against a mock OpenID provider in the API and browser tests, **not against
  a real identity provider**. Before relying on it, sign in once through each provider you use.
- No SAML, no SCIM groups, no per-project roles from the directory, and providers that only allow
  `client_secret_basic` or private-key JWT client authentication are not supported yet.
- Identity providers on a private network need `SSO_ALLOW_INSECURE_ISSUER` (development only) or a
  public address; there is no allow-list for internal providers yet.
- No billing, invoices or self-service plan changes. Limits are counted live with indexed queries;
  under heavy traffic the completes check adds one count query per new interview.
