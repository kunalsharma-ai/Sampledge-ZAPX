# ADR 0033: Blueprint phase 5, enterprise scale

Status: accepted (2026-11-05)

## Context

Phase 5 of the ZAPX blueprint asks for an automation engine (rules, schedules, approvals,
notifications), SAMPLEON and Bidzo adapters, data residency and retention, and hardening. Items moved
here from phase 4 are chart dashboards and segmentation filters, rule-based cleaning, webcam eye
tracking and AI-written test cases. Phase 3 left SMS invitations, and the Theme Studio left
per-module theme overrides and workspace presets. The blueprint forbids fake integrations, invented
AI capabilities, security certifications and untested parity claims.

## Decision

1. **Automation rules use the webhook events.** A rule is trigger → conditions → actions.
   - **Triggers:** `response.finished`, `response.review_decided`, `quota.full` (new),
     `survey.published`, `survey.status_changed`, or a schedule (hourly, daily or weekly, in UTC).
   - **Conditions:** they read the event (`event.qualityScore`) or the survey's numbers computed on
     demand (`metrics.completes`, `incidence`, `qualityFailRate`, `hoursSinceLastComplete` and others).
   - **Actions:** an in-app notification, an email (through the existing mailer), the signed
     `automation.fired` webhook, or a change to the survey's status.
   - **Running:** `WebhookService.emit` queues one `AutomationRun` per listening rule and never throws.
     The job worker claims runs with `FOR UPDATE SKIP LOCKED`.
   - **Cooldown:** a cooldown is claimed atomically on `lastFiredAt`.
   - **Approval:** a rule with `requiresApproval` holds its actions until an administrator approves,
     and its admins get a notification.
   - **No loops:** events caused by an automation carry `causedBy: "automation"` and never fire rules.
   - **Logging:** every run records the condition values it saw and each action's result. A dry run
     checks the conditions against the survey's numbers now, without acting.
2. **`quota.full` comes from the stored quota cells.** It fires when a complete's cell reaches its
   target exactly. Later completes are refused by the quota, so normally only one event fires.
3. **Residency is a control, not a certification.**
   - **What ZAPX can't do:** it can't move data between regions.
   - **Regions:** the deployment declares `DATA_REGION`. The organization sets the region its data
     must stay in, and the settings page says whether the two match.
   - **Outside services:** the page lists every configured service that receives organization data.
     With `blockExternalProcessors` it refuses the ones that aren't needed to deliver the service
     (AI calls, transcription, network reputation lookups). Email, SMS, telephony and S3 are listed
     but stay on, since turning them off would stop the feature.
4. **Retention erases, it does not delete rows.**
   - **Interviews:** after `responsesDays`, ZAPX clears the answers, link parameters, user agent,
     network and device hashes, location, evidence, open-end fingerprints, photos and recordings.
     The uid becomes `erased-<id>` and `erasedAt` is set. Status and timings stay, so fieldwork
     counts remain true. Analysis and exports skip erased rows.
   - **Captures:** `capturesDays` deletes photos and recordings, and works with
     `CAPTURE_RETENTION_DAYS`.
   - **Contacts:** `contactsDays` clears their email, phone, name and columns. Contacts who
     unsubscribed keep their address, so they are never invited again.
   - **When it runs:** the worker applies the policy hourly, and each run is audited.
5. **Cleaning rules are analysis-time edits, like recodes.**
   - **Rules:** `def.cleaning` holds ordered set, clear and impute rules (mean, median or mode).
     Each has an optional condition and targets one single-value question.
   - **Where they apply:** `applyCleaning` (logic engine) applies them to copies of the answers before
     calculated variables are worked out, in both analysis and exports.
   - **What it shows:** exports add a `cleaning_rules` column, and Analysis marks the variables it
     changed. Stored answers never change.
   - **Checks and XML:** the analyzer checks the targets, values and conditions. ZAPX XML uses
     `<clean question=...>`, because `target` is already a quota number attribute.
6. **Segments and dashboards reuse the tables.** `filters.answers` keeps the records that match every
   filter (codes, or a numeric range, optionally negated). Filtering happens after cleaning and
   derived variables, so a segment can use a recode. A dashboard is a saved report of chart tiles
   (bars, columns, donut, number), each one a weighted frequency. Its Excel export holds the tables.
7. **SMS goes through the email waves.**
   - **Contacts:** they can have an E.164 phone number, an email address, or both.
   - **Waves:** a wave has a channel. An SMS wave has no subject and is limited to 600 characters
     plus the link, with an opt-out link added.
   - **Provider:** Twilio's Messages API, with a number or a Messaging Service. It is off by default
     (`SMS_PROVIDER`) and tested against a local stand-in only.
8. **Area themes live in the appearance.**
   - **Area themes:** `appearance.modules` maps a studio area (dashboard, build, fieldwork, analysis,
     library, settings) to a theme family. Mode, accent, density and motion stay the member's own.
   - **Presets:** workspace presets are named appearances that an administrator saves for the
     organization, and that members apply to their own appearance.

## Not built in this phase

- **SAMPLEON and Bidzo adapters.** Their API contracts haven't been provided. Building them now would
  mean inventing their APIs, which is the fake integration the blueprint forbids. Webhooks (including
  `automation.fired`) and the vendor API already cover pushing events and pulling status, and an
  adapter will be one class each once the contracts arrive.
- **Webcam eye tracking.** The reason is the same as in phase 4. A face-landmark model would have to be
  served from ZAPX and its accuracy checked on real webcams, and this environment can do neither.
  Shipping it untested would be a parity claim.
- **AI-written test cases.** They stay as suggested cases from simulation (phase 4), because those can
  be proven to pass.

## Consequences

- **Migration:** `20261116000000_blueprint_p5` adds:
  - the models `AutomationRule`, `AutomationRun` and `Notification`;
  - the Tenant columns `dataRegion`, `blockExternalProcessors`, `retention` and `appearancePresets`;
  - `Contact.phone` (email becomes optional), `Distribution.channel` and `Response.erasedAt`.
- **New settings:** `SMS_PROVIDER`, `SMS_FROM` and `DATA_REGION`.
- **New webhook events:** `quota.full` and `automation.fired`.
- **Tests:**
  - `logic-engine` `cleaning.test.ts`;
  - `analysis-core` segments in `derived.test.ts`;
  - `quantum` area themes;
  - `apps/api/test/blueprint5.test.ts` (18 tests);
  - `e2e/tests/blueprint5.spec.ts`.
