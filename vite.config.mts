import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const projectRoot = dirname(fileURLToPath(import.meta.url));

type MonacoEditorPluginFactory = (options: { languageWorkers: string[] }) => PluginOption;

function monacoEditorPlugin() {
  const pluginModule = require('vite-plugin-monaco-editor') as
    | MonacoEditorPluginFactory
    | { default?: MonacoEditorPluginFactory };
  const pluginFactory = typeof pluginModule === 'function' ? pluginModule : pluginModule.default;
  if (!pluginFactory) {
    throw new Error('vite-plugin-monaco-editor did not export a plugin factory');
  }
  return pluginFactory({
    languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html'],
  });
}

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, '/');
  if (!normalizedId.includes('/node_modules/')) return undefined;

  if (normalizedId.includes('/node_modules/@xterm/')) return 'vendor-terminal';
  if (
    normalizedId.includes('/node_modules/react-syntax-highlighter/') ||
    normalizedId.includes('/node_modules/refractor/core.js') ||
    normalizedId.includes('/node_modules/prismjs/')
  ) {
    return 'vendor-syntax';
  }
  if (
    normalizedId.includes('/node_modules/react-markdown/') ||
    normalizedId.includes('/node_modules/remark-gfm/') ||
    normalizedId.includes('/node_modules/unified/') ||
    normalizedId.includes('/node_modules/bail/') ||
    normalizedId.includes('/node_modules/ccount/') ||
    normalizedId.includes('/node_modules/comma-separated-tokens/') ||
    normalizedId.includes('/node_modules/decode-named-character-reference/') ||
    normalizedId.includes('/node_modules/devlop/') ||
    normalizedId.includes('/node_modules/entities/') ||
    normalizedId.includes('/node_modules/escape-string-regexp/') ||
    normalizedId.includes('/node_modules/hast-util-') ||
    normalizedId.includes('/node_modules/html-') ||
    normalizedId.includes('/node_modules/is-plain-obj/') ||
    normalizedId.includes('/node_modules/longest-streak/') ||
    normalizedId.includes('/node_modules/markdown-table/') ||
    normalizedId.includes('/node_modules/mdast-util-') ||
    normalizedId.includes('/node_modules/micromark') ||
    normalizedId.includes('/node_modules/property-information/') ||
    normalizedId.includes('/node_modules/space-separated-tokens/') ||
    normalizedId.includes('/node_modules/trim-lines/') ||
    normalizedId.includes('/node_modules/trough/') ||
    normalizedId.includes('/node_modules/unist-') ||
    normalizedId.includes('/node_modules/vfile') ||
    normalizedId.includes('/node_modules/zwitch/')
  ) {
    return 'vendor-markdown';
  }
  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'vendor-react';
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), monacoEditorPlugin()],
  base: './',
  root: '.',
  resolve: {
    alias: {
      '@': resolve(projectRoot, 'src/renderer'),
      '@shared': resolve(projectRoot, 'src/shared'),
    },
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      // Stub any missing refractor/lang/* files so react-syntax-highlighter's
      // async language loader never throws at build time (npm dedupe can drop
      // language files that were present during the original install).
      plugins: [
        {
          name: 'stub-missing-refractor-lang',
          resolveId(id) {
            if (id.match(/^refractor\/lang\//)) return id;
            return null;
          },
          load(id) {
            if (id.startsWith('refractor/lang/')) {
              return 'export default function() { return null; }';
            }
            return null;
          },
        },
      ],
      output: {
        manualChunks,
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: { host: '127.0.0.1', port: 5173 },
  },
});
