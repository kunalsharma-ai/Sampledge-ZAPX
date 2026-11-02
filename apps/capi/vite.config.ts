import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.ZAPX_API_URL ?? 'http://localhost:4000';

// The interviewer app reaches the API at /api on its own origin (same-origin session cookie).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
});
