/**
 * Face landmarks for webcam eye tracking (experimental), from MediaPipe's face landmarker running in
 * the respondent's browser. The library, its WebAssembly and the model are served by SampCode itself
 * (public/eyetracking), loaded only when a respondent agrees to an eye-tracking task, and the camera
 * picture never leaves the device.
 */
import type { EyeTrackingHost, FaceLandmarkSource } from '@zapx/survey-renderer';

const BASE = `${import.meta.env.BASE_URL}eyetracking`;

export const eyeTrackingHost: EyeTrackingHost = {
  async createFaceTracker(): Promise<FaceLandmarkSource> {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const landmarker = await FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${BASE}/model/face_landmarker.task`, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    let last = 0;
    return {
      detect(video, nowMs) {
        // The landmarker needs strictly increasing timestamps.
        const t = Math.max(nowMs, last + 1);
        last = t;
        const out = landmarker.detectForVideo(video, t);
        return out.faceLandmarks[0] ?? null;
      },
      close: () => landmarker.close(),
    };
  },
};
