# 0015: CATI call lists on the existing interview engine

Status: Accepted (Milestone 9)

## Context

Many Sampledge studies (B2B, older audiences, follow-ups) are fielded by phone. ZAPX already had
online (CAWI) and face-to-face (CAPI) interviewing on one logic engine. Phone interviewing needs
a list of people to call, a fair queue for several interviewers, rules for retries and callbacks,
and the interview itself. A dialer (telephony provider) is not available yet.

## Decision

- **Call lists** (`CatiCase`) per survey, uploaded as CSV (id, phone, optional name, any other
  columns as sample data passed to the survey as entry parameters). Phone numbers are normalised,
  sealed with `SecretBox`, and only the last three digits are stored in clear for display.
- **One queue, callbacks first.** Interviewers ask for the next case; the API claims one with
  `FOR UPDATE SKIP LOCKED` and a 30-minute lease, so two interviewers never get the same person and
  an abandoned screen frees its case. Due callbacks come before retries and new cases.
- **Dispositions** decide what happens next: no answer (retry in 2 h), busy (15 min), answering
  machine (4 h), callback (at the agreed time), refused, wrong number, not eligible (closed), and
  interviewed. A case closes after its maximum attempts. Every call is kept (`CatiCall`).
- **The interview is the same engine.** "Start interview" creates (or resumes, with a new token) a
  `Response` with mode `CATI`, the interviewer, and the case id as UID, and opens it in the
  respondent runtime. When the interview has ended, the case is closed as interviewed whatever the
  interviewer selects; "interviewed" cannot be recorded for an unfinished interview.
- **Who calls.** Interviewers assigned to the survey (the same assignment as CAPI), plus admins and
  programmers. Opening a case reveals the number and is audited (`cati.case_open`).
- **Privacy.** Admins can erase the phone numbers of finished cases; call history stays.
- **Dialing is manual:** the number is a `tel:` link, so interviewers use their own phone or
  softphone. No call recording.

## Consequences

- Works without any telephony contract; the queue and outcomes are ready for a dialer later
  (Twilio or a predictive dialer would claim cases through the same queue).
- No automatic dialing, recording, time-zone-aware calling windows or do-not-call list yet.
- Voice-over and transcription were planned with CATI; they need a speech provider and move to the
  rich-media milestone.
