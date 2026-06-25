import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy API + worker + socket.io to the server on :3000 so the app can
// run on Vite's :5173 with same-origin-style calls. In production the server
// serves the built assets, so everything is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/worker': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
