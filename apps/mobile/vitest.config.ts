import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure logic (entitlements, API client, recipes). Screens are checked by
// the type checker and the web preview; React Native components are not rendered in Node.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
