# 0017: Rich media and advanced question types

Status: Accepted (Milestone 11)

## Context

Concept, ad and pack tests need images, video and audio in the questionnaire, pictures as
answers, and the question types researchers use every day: rating scales and NPS, ranking,
constant sum and sliders. Voice-over and transcription were also on the list.

## Decision

- **New question types** in `@zapx/survey-schema`, handled by the same logic engine everywhere
  (server, studio preview, CAPI app):
  - `scale`: one whole number between `min` and `max` (button row), optional end labels, an
    optional answer outside the scale ("don't know"), and `nps` (0-10, analysis reports the NPS).
  - `ranking`: stored as the codes in rank order; `rankCount` ranks only the top N. In logic,
    `RANK.2` is the rank given to code 2 (1 = first; null when not ranked).
  - `sum` (constant sum): stored as code → amount; must add up to `total`; empty items become 0.
    In logic, `SPEND.1` is the amount given to code 1.
  - `numeric` gains `display: 'slider'` (needs min and max). An untouched slider has no answer.
- **Ranking by tapping**, not drag and drop: tap items in order, then fine-tune with up and down
  buttons. It works with a keyboard, screen readers and touch.
- **Media are uploaded, never linked.** `MediaAsset` rows (random 22-character ids) with bytes in
  the existing `FileStore`. External URLs are not allowed: they would leak respondents' network
  addresses to third parties and could change after the questionnaire was approved. File types
  are detected from the content (PNG, JPEG, WebP, GIF, MP4, WebM, MP3, M4A, OGG, WAV); SVG is
  refused because it can carry script. Images up to 10 MB, audio 25 MB, video `MEDIA_MAX_MB`.
- **Serving**: `GET /api/public/media/:id`, public (respondents have no account), cacheable for a
  year (content never changes under an id), byte ranges for video seeking, `nosniff`.
- **Integrity**: publishing fails if the questionnaire uses media that is not a live upload of the
  survey; a file used by any version cannot be deleted.
- **Play to the end**: video and audio can require playing to the end before Next is enabled.
  This is a respondent-side courtesy, not proof of viewing, and is documented as such.
- **CAPI offline**: when the interviewer app downloads surveys it also downloads their media into
  a cache that its service worker serves, so media work without a connection.
- **Read aloud** (`presentation.readAloud`) uses the respondent's own device voices (Web Speech
  API). Nothing is sent anywhere. It is the voice-over available without a speech provider.
- **Analysis and exports**: scales are categorical with a mean (don't know excluded) and NPS;
  ranking and constant sum items become one numeric variable or column each (`RANK_2`, `SPEND_1`).

## Consequences

- Concept and ad tests run end to end, online and offline, with no third-party media hosts.
- Media are public to anyone who has the id (like any image on a survey page); do not upload
  confidential material that respondents should not be able to share.
- Not built: recorded voice-over per language and transcription of spoken answers (both need a
  speech provider), MaxDiff and conjoint, heatmaps on images, video in CATI, and an S3 store
  (the local store is still the only adapter, see ADR 0013).
