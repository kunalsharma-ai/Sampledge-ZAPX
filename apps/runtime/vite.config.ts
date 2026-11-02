import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.ZAPX_API_URL ?? 'http://localhost:4000';

// The runtime is served on the survey domain and reaches the API at /api on the same origin.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api } },
  preview: { proxy: { '/api': api } },
});
