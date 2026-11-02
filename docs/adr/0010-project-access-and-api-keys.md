# 0010: Project-level access and organization API keys

Status: Accepted (Milestone 6)

## Context

Agencies run many clients in one ZAPX organization. Freelance programmers, client-side viewers and
partner teams should only see the projects they work on. Integrations (data pipelines, PM tools,
scripts) need to call the API without a person's password, and every action they take must be
traceable to a person.

Roles answer "what can you do"; they do not answer "on which projects".

## Decision

- **Project scope on members.** `User.projectScope` is `ALL` (default, every project) or `ASSIGNED`
  (only projects listed in `ProjectMember`). Admins always have `ALL`; interviewers keep using survey
  assignments. Only admins add or remove project members.
- **One place for the filters.** `AccessService` returns the Prisma `where` for projects, surveys and
  vendors for the signed-in member. Every studio lookup by id or list goes through it (projects,
  surveys, vendors, callbacks, redirect logs, QA runs, change sets, quality, fieldwork, CAPI
  assignments, exports). Anything outside a member's projects answers 404, never 403, so ids are not
  confirmed. A scoped member who creates a project is added to it.
- **Fresh roles.** The guard reads the member from the database on every request instead of trusting
  the role in the session token, so a role or scope change applies to the next request.
- **API keys.** `zapx_<12 hex prefix>_<32 char secret>`, sent as `Authorization: Bearer`. ZAPX stores
  the prefix and a SHA-256 hash of the secret, never the key. A key:
  - acts as the member who created it (the audit trail records that member plus `viaApiKey`);
  - has role `PROGRAMMER` or `VIEWER`, and its effective role is the lower of the key's and the
    creator's current role (demoting a member demotes their keys; an interviewer's keys stop working);
  - sees the creator's projects;
  - cannot create, list or revoke keys;
  - can expire, and is revoked instantly. `lastUsedAt` is written at most once a minute.
    Admins see and revoke every key; programmers manage their own.

## Consequences

- One extra indexed query per request (the member, or the key and its creator). Acceptable at
  current volumes; a short in-process cache can be added later if needed.
- New endpoints must use `AccessService` (or `SurveysService.getSurvey`) for any project, survey or
  vendor lookup. The Milestone 6 tests cover every existing route family for a scoped member.
- Keys are bearer secrets. They are not bound to IP ranges yet, and there is no per-key scope narrower
  than a role. SSO and SCIM provisioning are separate, later work.
