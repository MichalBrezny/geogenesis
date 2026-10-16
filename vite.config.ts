/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [react()],
  server: {
    // Native file watching on Windows sometimes misses writes and serves stale modules.
    watch: { usePolling: true, interval: 300 },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
