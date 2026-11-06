// Copies MediaPipe's vision WebAssembly files into public/, so eye tracking is served from SampCode
// itself (no outside CDN, which the respondent page's Content-Security-Policy would refuse anyway).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..', 'node_modules', '@mediapipe', 'tasks-vision');
const out = join(here, '..', 'public', 'eyetracking', 'wasm');
mkdirSync(out, { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) copyFileSync(join(pkg, 'wasm', f), join(out, f));
