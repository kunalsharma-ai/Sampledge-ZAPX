# Access control, API keys and the audit log (Milestone 6)

## Roles and project access

| Role        | Can do                                                    | Projects                                |
| ----------- | --------------------------------------------------------- | --------------------------------------- |
| Admin       | Everything, including team, settings, webhooks, audit log | All                                     |
| Programmer  | Build, publish, review quality, manage own API keys       | All, or only assigned (Settings → Team) |
| Viewer      | Read only                                                 | All, or only assigned                   |
| Interviewer | Only the CAPI app, for surveys assigned to them           | None in the studio                      |

- **Assigned projects.** Set a programmer or viewer to "Assigned projects" in Settings → Team, then
  add them on each project page under Project access. They see nothing else: other projects,
  their surveys, vendors, logs, data and exports answer 404.
- A scoped member who creates a project is added to it automatically.
- Role and access changes apply to the member's next request (no need to sign out).
- Admins cannot remove their own admin role.

API: `GET/POST /api/projects/:id/members`, `DELETE /api/projects/:id/members/:userId`,
`PATCH /api/users/:id` with `{ role?, projectScope? }`.

## API keys

For scripts and integrations. Create one in Settings → API keys (programmers: the "API keys" link in
the header). The key is shown once:

```
zapx_3f9a0c1b2d4e_Xr8w...32 characters...
```

Use it as a bearer token against the same API the studio uses:

```bash
curl -H "Authorization: Bearer $ZAPX_KEY" https://zapx.example.com/api/projects
curl -H "Authorization: Bearer $ZAPX_KEY" "https://zapx.example.com/api/surveys/$SURVEY/export?format=csv" -o data.csv
```

Rules:

- A key acts as the member who created it and sees the same projects.
- Its role is programmer or viewer; the effective role is the lower of the key's and the creator's
  current role. Admin-only endpoints (team, settings, webhooks, audit log) never accept a key.
- Keys cannot manage keys. They can expire (30 days, 90 days, 1 year or never) and are revoked at once.
- Changes made with a key appear in the audit log under the creator, marked "via API key".
- SampCode stores only a SHA-256 hash of the secret part. A lost key cannot be recovered; create a new one.

API: `GET/POST /api/api-keys`, `DELETE /api/api-keys/:id` (revoke).

## Audit log

Settings → Audit log (admins). Every change in the organization, newest first: projects, surveys,
publishing, vendors, links, exports, QA runs, change sets, quality decisions, CAPI assignments and
syncs, members, project access, API keys, webhooks and settings.

- Filter by action (or a group such as `webhook.*`), entity type, member and time range.
- "Download CSV" exports up to 50,000 matching events (time, member, action, entity, details as
  JSON); spreadsheet formulas in values are neutralized. The export itself is audited.
- Audit events cannot be edited or deleted through SampCode.

API: `GET /api/audit?action=&entityType=&entityId=&actorId=&from=&to=&after=&take=`,
`GET /api/audit/actions`, `GET /api/audit/export.csv`, `GET /api/audit/security`.
