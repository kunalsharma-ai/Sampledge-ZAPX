# 0024: CATI calling hours and the do-not-call list

Status: Accepted (Milestone 18). Extends 0015.

## Context

Phone fieldwork must not call people at night in their time zone, and must stop calling anyone who
asked not to be called again, in every study of the organization. Interviewers cannot be expected
to check either by hand, and a sample often spans several time zones.

## Decision

- **Enforced in the queue.** The `next` query only offers cases that are inside the survey's calling
  hours in the case's own time zone (else the survey's), using PostgreSQL's `AT TIME ZONE` on the
  same IANA names the API validates. An interviewer is never shown a case they must not call.
- **Agreed callbacks are exempt** from calling hours: the respondent chose the time.
- **No calling hours means no restriction**, as before; the studio says so prominently. Imposing a
  default window would have changed running fieldwork silently.
- **One do-not-call list per organization**, holding an HMAC of the normalized number (keyed from
  `SECRETS_KEY`, per organization) and the last three digits. Listed numbers are excluded in the same
  query, across all surveys. Cases from before this milestone get their hash on the next queue pass.
- **"Do not call again" is a call outcome** that adds the number and closes the case. Removing a
  number is an administrator action, audited.

## Consequences

- One calling window per survey; per-country rules (e.g. different weekend hours) need a window per
  survey or a later extension.
- Rotating `SECRETS_KEY` breaks matching against the list (as it breaks the sealed numbers).
