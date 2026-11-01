import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], fileParallelism: false, testTimeout: 20000 },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
