# 0018: Fraud detection and face-to-face capture

Status: Accepted (Milestone 12)

## Context

Panel fraud has moved past speeders and straightliners: scripted browsers, survey farms answering
from the wrong country, the same person entering through several vendors, and copy-pasted open
answers. Face-to-face fieldwork has its own fraud: interviews made up at home, or two interviews
"conducted" at once. Supervisors ask for the location, a recording and photos as evidence.

All of this touches personal data (devices, places, voices, homes), so it has to stay useful as
evidence for a reviewer without becoming tracking.

## Decision

- **Signals, not verdicts.** Every fraud signal is a quality flag with points, in the existing score
  (ADR 0007). Nothing is rejected silently: low scores go to the review queue, and only the
  survey's own `rejectBelow` (off by default) rejects inside the survey.
- **Browser signals** (online, `settings.quality.fraud`, on by default):
  - `automation`: the browser reports `navigator.webdriver` (60 points).
  - `honeypot`: a field hidden from view, from screen readers (`aria-hidden`) and from the tab order
    was filled in (60).
  - `no_interaction`: two or more pages answered with no keyboard, pointer or touch input at all
    (30). The Next click itself counts, so a person using any input method is never flagged;
    scripts that set values and submit are.
  - `open_pasted`: an open answer was pasted in (10 each, up to 5).
  - Only counts and question ids are sent, never keystrokes or text.
- **Same device** (`same_device`, 25): the runtime sends coarse traits every site can read (screen
  size and colour depth, time zone, languages, platform, cores, memory, touch points). The API
  keeps `HMAC(key, tenant + user agent + traits)`, never the traits. No canvas, audio or font
  fingerprinting: they identify people across sites, which we do not need. Two identical laptops
  look like one device, so this is review evidence only.
- **Country** (`geo_mismatch`, 30): only when `GEO_COUNTRY_HEADER` names the header an edge network
  (CloudFront, Cloudflare) sets. The expected countries are `settings.quality.countries`, or the
  vendor's `cc` parameter. ZAPX does not ship an IP-to-country database.
- **Block list** (`blocked_device` 60, `blocked_network` 40): a reviewer who rejects a complete can
  also block its device and network hashes for the whole organization. Stored as hashes only;
  administrators see where each entry came from and can remove it. Blocking flags, it never turns
  people away at the door, because shared networks (offices, mobile carriers) would lock out
  innocent respondents.
- **Photo question** (`type: 'photo'`): the answer is a reference. The device shrinks the photo to
  1600 px and re-encodes it as JPEG, which drops EXIF metadata such as the exact place it was taken;
  a photo the browser cannot decode is refused rather than sent with its metadata. Online, the
  runtime uploads it with the session token; the page is refused if the reference has no file.
  Replaced photos are deleted when the interview ends.
- **CAPI capture** (`settings.capi`, versioned with the survey):
  - `gps: off | optional | required`. The app takes the position when the interview starts and
    ends; the API rounds it to 5 decimals (about a metre). Required: the app will not start an
    interview without a location, and the server flags `gps_missing` (30) if one arrives anyway.
    An interview ending more than 1 km from its start is flagged `gps_moved` (15).
  - `audio: off | consent`. The interviewer reads out the consent text and records the answer.
    Recording starts only after "agrees", is never silent, shows a recording indicator, and is
    written to the device every 10 seconds so a closed app keeps what was recorded. The outcome
    (recorded, declined, unavailable) is stored with the interview.
  - `interviewer_overlap` (40): the server flags an interview that overlaps another interview by
    the same interviewer by more than a minute. Made-up interviews often do.
- **Captures are private.** A separate `Capture` table (not `MediaAsset`, which is public by id),
  under the same row-level security policy as responses. `GET /api/captures/:id` requires a studio
  login with access to the survey, sends `Cache-Control: private` and
  `Cross-Origin-Resource-Policy: same-origin`, and audits the first read of each view (players
  fetch audio in many ranges). Types are detected from the bytes: JPEG, PNG or WebP photos up to
  15 MB; WebM, Ogg, MP4, MP3 or WAV recordings up to `CAPTURE_MAX_MB`.
- **CAPI upload order.** The app uploads an interview's files first (idempotent by interview id and
  reference), then the interview; the server links them. An interview waits while a file is still
  uploading. A file the server refuses is not retried, so it can never block an interview. Files
  are deleted from the device once the server has the interview.
- **Erasure and retention.** Administrators can erase every photo and recording of a survey (answers
  keep their references). `CAPTURE_RETENTION_DAYS` deletes captures automatically in housekeeping.

## Consequences

- Fraud evidence sits in one place (the review queue), with the same accept/reject flow and audit
  trail as other quality issues. Vendors are told `quality_fail` only when a person rejects.
- End-to-end tests run Chromium with `--disable-blink-features=AutomationControlled`, otherwise every
  test respondent would be flagged as automation; the API tests cover the automation check.
- A determined fraudster can spoof every browser signal. These checks raise the cost of cheap fraud
  and make patterns visible; they are not proof, and the documentation says so to reviewers.
- Not built: network reputation (VPN, data-centre and proxy lists), which needs a commercial
  feed; device-level attestation; maps in the review queue (the coordinates are shown as text, so
  no third-party map service learns where interviews happen); audio transcription.
