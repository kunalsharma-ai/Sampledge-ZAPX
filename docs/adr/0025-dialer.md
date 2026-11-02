# 0025: Phone dialer and call recording through a provider adapter

Status: Accepted (Milestone 19). Extends 0015 and 0024.

## Context

Interviewers dialled the number shown on the case themselves. That shows every respondent's number
to every interviewer, cannot record calls, and relies on the interviewer's own phone line and caller
id. Kunal asked for the remaining product gaps to be built behind pluggable adapters with the
recommended providers, ready to work once credentials are added.

## Decision

- **Click to call, interviewer first.** ZAPX asks the provider to ring the interviewer's own phone;
  when they answer, the provider fetches instructions from ZAPX and dials the respondent from the
  organization's caller id. This needs no softphone in the browser and works with any phone, and the
  respondent's number never reaches the interviewer.
- **Twilio** Programmable Voice is the first provider (REST API to place and end calls, TwiML for
  the bridge, status and recording callbacks). `TelephonyProvider` is an interface; another provider
  is one class plus its webhook routes.
- **Webhooks are authenticated by `X-Twilio-Signature`** computed over the public URL under
  `TELEPHONY_WEBHOOK_BASE`, not over the request's own Host header, which proxies change. The call id
  in each URL is a random 128-bit value as well.
- **Off twice by default**: `TELEPHONY=off` for the installation, and per survey until a programmer
  turns it on. Surveys without it behave exactly as before.
- **Recording is per survey and explicit**, with a notice read to the respondent before they are
  connected. Recordings become private captures of the interview and are deleted at the provider
  once copied, so personal data is kept in one place under one retention policy. Calls without an
  interview keep nothing.
- The do-not-call list and the case lock are checked again when the respondent is about to be dialled.

## Consequences

- Every call has two billed legs at the provider.
- The integration is tested against a local stand-in of the Twilio API only. Before production use,
  place real calls with a Twilio trial account and confirm the signature check with the real
  `TELEPHONY_WEBHOOK_BASE`.
- Predictive dialing, answering-machine detection and in-browser calling are not covered.
