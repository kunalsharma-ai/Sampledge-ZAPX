# 0023: Transcripts of interview recordings through a provider adapter

Status: Accepted (Milestone 17). Extends 0018.

## Context

Face-to-face recordings (ADR 0018) are evidence, but nobody listens to hundreds of hours. A
transcript next to the answers lets a reviewer check in a minute whether the questions were asked.
Speech-to-text needs a provider, and recordings are among the most sensitive data ZAPX holds.

## Decision

- **A `SpeechToTextProvider` adapter** with Deepgram's pre-recorded API as the first provider: one
  HTTPS call with the audio as the body, WebM and Ogg accepted as recorded, many languages, and
  priced per minute. The model is a required setting (`DEEPGRAM_MODEL`), never a default in code.
  AWS Transcribe (keeps audio in the AWS account) is a reasonable second provider.
- **On request, never automatic.** An admin or programmer starts a job after a confirmation saying
  the recordings leave ZAPX. Only recordings linked to an interview and without a transcript are
  sent, so asking twice sends nothing twice.
- **Background job** (the existing job queue, ADR 0013), up to 200 recordings per job, with
  progress. Workers without a provider do not claim these jobs.
- **Stored with the recording** (`Capture.transcript`), same access, same deletion (erase and
  retention), shown in the review queue as machine transcription.

## Consequences

- Transcripts are not searchable and do not feed the quality score yet; a reviewer reads them.
- Tested against a local stand-in of the Deepgram API, in API and browser tests, not Deepgram itself.
