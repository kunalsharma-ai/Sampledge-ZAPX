# Phone interviewing: CATI (Milestone 9)

Design and trade-offs: [ADR 0015](../adr/0015-cati-call-lists.md).

## Set up a phone survey

1. Publish the survey (it must be live).
2. **Interviewers tab → Interviewers:** assign interviewers (the same assignment is used for CAPI).
3. **Interviewers tab → Phone interviews (CATI):** upload a CSV and choose the maximum attempts.

```csv
id,phone,name,city,tier
NB-1001,+91 98200 00000,Asha Rao,Pune,Gold
NB-1002,+91 98200 07919,Ravi Iyer,Delhi,Silver
```

- `id` (or `code`, `uid`, `respondent_id`) becomes the interview's UID; letters, digits, `.`, `-`, `_`.
- `phone` (or `phone_number`, `telephone`, `mobile`): spaces, dashes and brackets are ignored; keep
  the country code.
- `name` is optional. Every other column is sample data, shown to the interviewer and passed to the
  survey as an entry parameter (for example `[param:city]` in redirects or piping).
- Rows with a bad id or number, and ids already in the list, are skipped and reported.

## Calling

Interviewers open **Calls** (top bar), pick a survey and take the next case.

- Callbacks that are due come first, then retries and new cases, oldest first.
- The number is a `tel:` link; dial with your phone or softphone. ZAPX does not dial or record.
- **Start interview** opens the survey in a new tab. Read each question aloud and enter the answers.
  If the call drops, record a callback; starting again resumes where it stopped.
- **How did the call end?**

| Outcome           | Next                                       |
| ----------------- | ------------------------------------------ |
| No answer         | Tried again in 2 hours                     |
| Busy              | Tried again in 15 minutes                  |
| Answering machine | Tried again in 4 hours                     |
| Call back later   | Called again at the time you choose        |
| Refused           | Closed                                     |
| Wrong number      | Closed                                     |
| Not eligible      | Closed                                     |
| Interviewed       | Closed (only once the interview has ended) |

A case closes after its maximum attempts. If the interview has ended, the case is closed as
interviewed whatever you choose. **Give the case back** returns it to the queue without a call.
An interviewer holds a case for 30 minutes at most; after that anyone can take it.

## Following the list

The panel shows how many cases are to call, due now, on callback, in a call, interviewed and
closed, and calls per interviewer in the last 24 hours. Filter the table by status. Programmers can
reopen a closed case for one more attempt. Interviews appear in Quotas & data with mode CATI and
the interviewer's name, and in the fieldwork dashboard.

## Privacy

Phone numbers are encrypted at rest; the list shows only the last three digits. Opening a case
(which shows the full number) is in the audit log. Admins can **erase finished phone numbers** for
interviewed and closed cases; the call history stays.

## API

| Method and path                               | Who                                                  |
| --------------------------------------------- | ---------------------------------------------------- |
| `POST /api/surveys/:id/cati/cases`            | admin, programmer (JSON cases)                       |
| `POST /api/surveys/:id/cati/cases/upload`     | admin, programmer (CSV `file`)                       |
| `GET /api/surveys/:id/cati/summary`, `/cases` | admin, programmer, viewer                            |
| `POST /api/cati/cases/:id/reopen`             | admin, programmer                                    |
| `POST /api/surveys/:id/cati/erase-phones`     | admin                                                |
| `GET /api/cati/surveys`                       | callers (assigned interviewers, admins, programmers) |
| `POST /api/cati/surveys/:id/next`             | callers                                              |
| `POST /api/cati/cases/:id/interview`          | the caller holding the case                          |
| `POST /api/cati/cases/:id/disposition`        | the caller holding the case                          |
| `POST /api/cati/cases/:id/release`            | the caller holding the case                          |

## Limits

No automatic or predictive dialing, call recording, calling-hours rules by time zone, or
do-not-call list yet. Voice-over and transcription are planned with rich media.
