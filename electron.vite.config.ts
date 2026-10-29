import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * The CSP in index.html forbids inline scripts, but Vite's dev server injects one
 * (React Fast Refresh). Drop the CSP meta in dev only; production keeps it.
 */
function devOnlyRelaxCsp(): Plugin {
  return {
    name: 'echo-dev-relax-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), devOnlyRelaxCsp()],
    worker: { format: 'es' },
    build: {
      minify: true,
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
    },
  },
});
