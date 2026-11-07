import { defineConfig } from 'vite';
import { offlinePlugin } from './scripts/offline-plugin.ts';

export default defineConfig({
  plugins: [offlinePlugin()],
  base: './',
  server: { host: '0.0.0.0', port: 5173, strictPort: true },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true },
});
