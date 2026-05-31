import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

function monacoEditorPlugin() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('vite-plugin-monaco-editor');
  const fn = p.default || p;
  return fn({
    languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
  });
}

export default defineConfig({
  plugins: [react(), monacoEditorPlugin()],
  base: './',
  root: '.',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: { host: '127.0.0.1', port: 5173 },
  },
});