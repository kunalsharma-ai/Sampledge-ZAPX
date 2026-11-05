// Shared lint rules for the whole monorepo. Formatting is Prettier's job (eslint-config-prettier
// turns off the overlapping rules); ESLint checks correctness and a few house rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import security from 'eslint-plugin-security';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
      '**/.terraform/**',
      // MediaPipe's WebAssembly loader, copied from node_modules at build time (not our code).
      'apps/runtime/public/eyetracking/wasm/**',
      'apps/mobile/.expo/**',
      'apps/mobile/expo-env.d.ts',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Static security analysis that runs with every `pnpm lint` (security review S8; GitHub's CodeQL
    // never runs on this plan). Only the rules that flag real risks without drowning in noise;
    // detect-unsafe-regex is left out: its 21 hits on main were all delimited or bounded patterns,
    // reviewed by hand (docs/handbook/SECURITY_REVIEW.md, S8).
    plugins: { security },
    rules: {
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-child-process': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-bidi-characters': 'error',
      'security/detect-possible-timing-attacks': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // NestJS injects constructor parameters by their runtime class, so those imports must stay values.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/studio/**/*.tsx', 'apps/runtime/**/*.tsx', 'packages/survey-renderer/**/*.tsx', 'apps/mobile/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
  {
    files: ['**/*.test.ts', 'e2e/**/*.ts', 'packages/db/src/seed.ts', 'apps/api/src/main.ts'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
