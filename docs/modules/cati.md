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
- `name` is optional. `timezone` (or `time_zone`, `tz`) is the respondent's IANA time zone, for
  example `Asia/Kolkata`; rows with an unknown zone are skipped. Every other column is sample data, shown to the interviewer and passed to the
  survey as an entry parameter (for example `[param:city]` in redirects or piping).
- Rows with a bad id or number, and ids already in the list, are skipped and reported.

## Calling

Interviewers open **Calls** (top bar), pick a survey and take the next case.

- Callbacks that are due come first, then retries and new cases, oldest first.
- The number is a `tel:` link; dial with your phone or softphone. ZAPX does not dial or record.
- **Start interview** opens the survey in a new tab. Read each question aloud and enter the answers.
  If the call drops, record a callback; starting again resumes where it stopped.
- **How did the call end?**

| Outcome           | Next                                                             |
| ----------------- | ---------------------------------------------------------------- |
| No answer         | Tried again in 2 hours                                           |
| Busy              | Tried again in 15 minutes                                        |
| Answering machine | Tried again in 4 hours                                           |
| Call back later   | Called again at the time you choose                              |
| Refused           | Closed                                                           |
| Wrong number      | Closed                                                           |
| Not eligible      | Closed                                                           |
| Interviewed       | Closed (only once the interview has ended)                       |
| Do not call again | Closed, and the number joins the organization's do-not-call list |

A case closes after its maximum attempts. If the interview has ended, the case is closed as
interviewed whatever you choose. **Give the case back** returns it to the queue without a call.
An interviewer holds a case for 30 minutes at most; after that anyone can take it.

## Calling hours (Milestone 18)

**Interviewers tab → Phone interviews → Calling hours**: a time zone, from and until (24-hour
clock, until is not included, `24:00` for midnight) and the days. Cases are then offered only when
it is inside those hours **in the respondent's local time**: the case's `timezone` from the call
list, else the zone set here. Agreed callbacks are called at their time even outside the hours,
because the respondent chose it. Overnight windows (22:00 to 02:00) are not supported.

Without calling hours, cases can be called at any time (the panel says so in orange). Set them
before fieldwork; local rules on calling times differ by country.

## Do-not-call list (Milestone 18)

One list for the whole organization, under the call list. A number on it is never offered to an
interviewer in any survey, also for cases added before it was listed.

- A respondent who asks not to be called is added when the interviewer records **Do not call
  again**.
- Programmers and admins add numbers by hand or upload a CSV (a `phone` column, or one number per
  line). Only admins can take a number off.
- Numbers are kept as a keyed hash per organization (HMAC from `SECRETS_KEY`) and their last three
  digits. Changing `SECRETS_KEY` breaks the matching (and the sealed numbers), so keep it.
- The call list summary counts waiting cases held back by the list.

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

| Method and path                               | Who                                                        |
| --------------------------------------------- | ---------------------------------------------------------- |
| `POST /api/surveys/:id/cati/cases`            | admin, programmer (JSON cases)                             |
| `POST /api/surveys/:id/cati/cases/upload`     | admin, programmer (CSV `file`)                             |
| `GET /api/surveys/:id/cati/summary`, `/cases` | admin, programmer, viewer                                  |
| `POST /api/cati/cases/:id/reopen`             | admin, programmer                                          |
| `POST /api/surveys/:id/cati/erase-phones`     | admin                                                      |
| `GET /api/cati/surveys`                       | callers (assigned interviewers, admins, programmers)       |
| `POST /api/cati/surveys/:id/next`             | callers                                                    |
| `POST /api/cati/cases/:id/interview`          | the caller holding the case                                |
| `POST /api/cati/cases/:id/disposition`        | the caller holding the case                                |
| `POST /api/cati/cases/:id/release`            | the caller holding the case                                |
| `GET`, `PUT /api/surveys/:id/cati/hours`      | read: admin, programmer, viewer; change: admin, programmer |
| `GET`, `POST /api/cati/do-not-call`           | admin, programmer (`{ phones: [...], note? }`)             |
| `POST /api/cati/do-not-call/upload`           | admin, programmer (CSV `file`)                             |
| `DELETE /api/cati/do-not-call/:id`            | admin                                                      |

## Limits

No automatic or predictive dialing or call recording here (see the dialer milestone). Calling hours
are one window per day, not per country.
