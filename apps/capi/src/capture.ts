/**
 * Face-to-face capture on the device (Milestone 12): the interview's location, the consented
 * recording and photo answers. Everything is kept in IndexedDB and leaves the device only by sync.
 */
import { captures, type DevicePoint, type LocalCapture } from './store';

/** The device's position, or null when it is unavailable, refused or too slow. */
export function locate(timeoutMs = 15_000): Promise<DevicePoint | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
          at: new Date(p.timestamp || Date.now()).toISOString(),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export const AUDIO_REF = 'audio';
const key = (clientId: string, ref: string) => `${clientId}:${ref}`;

/** Store a photo answer on the device; returns the reference that goes into the answer. */
export async function savePhoto(clientId: string, surveyId: string, photo: Blob): Promise<string> {
  const ref = crypto.randomUUID();
  await captures.put({
    key: key(clientId, ref),
    clientId,
    surveyId,
    ref,
    kind: 'photo',
    parts: [photo],
    type: photo.type,
    state: 'waiting',
  });
  return ref;
}

/**
 * Records the interview after the respondent agreed. Audio is written to the device every ten
 * seconds, so a closed app or a flat battery keeps what was recorded so far.
 */
export class InterviewRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly clientId: string,
    private readonly surveyId: string,
  ) {}

  /** Start recording. False when there is no microphone or the permission is refused. */
  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return false;
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(this.stream, type ? { mimeType: type, audioBitsPerSecond: 32_000 } : undefined);
    const k = key(this.clientId, AUDIO_REF);
    const empty: LocalCapture = {
      key: k,
      clientId: this.clientId,
      surveyId: this.surveyId,
      ref: AUDIO_REF,
      kind: 'audio',
      parts: [],
      type: recorder.mimeType || type,
      state: 'waiting',
    };
    await captures.put(empty);
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      this.writes = this.writes.then(async () => {
        const c = (await captures.get(k)) ?? empty;
        await captures.put({ ...c, parts: [...c.parts, e.data] });
      });
    };
    recorder.start(10_000);
    this.recorder = recorder;
    return true;
  }

  get recording() {
    return this.recorder?.state === 'recording';
  }

  /** Stop and wait until the last piece is saved. */
  async stop() {
    const r = this.recorder;
    if (r && r.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        r.addEventListener('stop', () => resolve(), { once: true });
        r.stop();
      });
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.recorder = null;
    this.stream = null;
    await this.writes;
  }
}
