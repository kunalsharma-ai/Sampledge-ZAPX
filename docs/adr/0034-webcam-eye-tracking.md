# ADR 0034: Webcam eye tracking (experimental)

Status: accepted (2026-11-05)

## Context

Eye tracking was left out of phases 4 and 5 because its accuracy could not be checked on real
webcams here. Kunal asked for it anyway. The blueprint forbids invented AI capabilities and
untested parity claims, so the feature has to say plainly what it is and what it is not.

## Decision

1. **A question type, `eyetrack`.**
   - **What it holds:** a picture, areas of interest (rectangles in percent, like hot-spot regions),
     how long the picture is shown (3 to 30 seconds), a calibration error limit and consent text.
   - **Experimental everywhere:** the analyzer warns `EXPERIMENTAL` on every eye-tracking question,
     and the editor, the respondent screen and the Analysis panel all say the estimate has not been
     validated on real webcams.
2. **The respondent opts in.**
   - **Consent first:** the consent text is shown before the camera starts, and "Skip this task" is
     always there. A Stop button stays on screen through calibration and viewing.
   - **Calibration:** 9 dots to fit the model, then 4 check dots to measure the error, in percent of
     the screen width. If the error is above the limit, the respondent gets one retry. Above twice the
     limit, the task ends as `calibration_failed`.
   - **Every outcome is stored:** `recorded`, `declined`, `unavailable` (no camera, permission
     refused, or a host without eye tracking such as the studio preview or the offline app), `no_face`
     or `calibration_failed`. That way the results show how many people actually took part.
3. **Nothing from the camera leaves the device.**
   - **On the device:** MediaPipe's face landmarker (Apache-2.0) runs in the browser. The library,
     its WebAssembly and the model are served by ZAPX from `/eyetracking/`, and the model file is
     committed with its sha256 below. The runtime's CSP gains `'wasm-unsafe-eval'`, which permits
     WebAssembly compilation and nothing else.
   - **The estimate:** gaze is worked out from the iris position between the eye corners, how open the
     eyes are, and the head's position and turn. A ridge regression is fitted to the calibration dots.
     The estimate is smoothed and sampled about every 50 ms.
   - **What is stored:** only points on the picture, in thousandths of its size, or `-` when the gaze
     is off the picture. No video and no images are kept.
4. **Results are approximate and labelled as such.**
   - **Who counts:** the Analysis panel counts each outcome and leaves out recordings above the error
     limit.
   - **What it shows:** the median, best and worst calibration error, and a heatmap where every
     respondent counts equally, blurred and capped at 250 ms per sample. For each area of interest it
     shows the percent who looked, the share of looking time, the mean time in the area and the mean
     time to first look.
   - **No fixations:** "Time to first look" is the first gaze point in the area. It is not a fixation,
     because no fixation detection is run on webcam-grade data.
   - **Exports:** they carry the status, the error and the share of looking time per area. They do
     not carry the raw gaze points.

## What is and is not tested

- **Tested:**
  - Parsing and validation, XML round trip, translation keys and simulation (`eyetrack.test.ts`).
  - The results maths (`eyetracking.test.ts`).
  - The estimator, on a synthetic face model: it recovers the gaze point when there is no noise, and
    the error grows with noise (`gaze.test.ts`).
  - The API end to end (`apps/api/test/eyetracking.test.ts`).
  - The browser, end to end (`e2e/tests/eyetracking.spec.ts`): the real model and WebAssembly load
    from ZAPX in Chromium. The test camera shows no face, so the run ends as `no_face`.
- **Not tested:** gaze accuracy on real people and real webcams. That needs real devices and real
  participants. Until it has been measured, ZAPX makes no accuracy claim beyond the per-respondent
  calibration error it measures and stores.

Model: `apps/runtime/public/eyetracking/model/face_landmarker.task` (float16, version 1),
sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.

## Consequences

- The respondent bundle grows only when an eye-tracking task starts: the library loads on demand,
  and the WebAssembly (about 14 MB) and the model (about 3.7 MB) are fetched then.
- No database migration. The answer is a string, like a signature.
