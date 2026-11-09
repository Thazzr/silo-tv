import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { webosHtml } from './build/webosHtml.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

// Dev only: when SILO_SERVER is set (the origin of a Silo server), the dev server proxies /api to
// it. Silo sends no CORS headers, so a browser on localhost could not call it directly.
const siloServer = process.env.SILO_SERVER;

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), webosHtml()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: siloServer
    ? { proxy: { '/api': { target: siloServer, changeOrigin: true, secure: true } } }
    : {},
  build: {
    target: 'chrome79',
    // `vite build --mode perf` (npm run perf:scroll) is the local profiling build: readable
    // function names for the CPU profile, written next to dist/ so it never replaces the bundle.
    ...(mode === 'perf' ? { minify: false, outDir: 'dist-perf' } : {}),
    modulePreload: false,
    // One bundle is intentional on webOS (classic script, no dynamic chunks; check:bundle
    // enforces it), so the default 500 kB chunk warning does not apply.
    chunkSizeWarningLimit: 2000,
    cssCodeSplit: false,
    rollupOptions: {
      output: { format: 'iife' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Above Testing Library's asyncUtilTimeout (8 s, src/test/setup.ts), so a waitFor reports its
    // own error instead of the test timing out first.
    testTimeout: 15_000,
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,mjs}',
      'build/**/*.test.ts',
      'tests/**/*.test.{js,ts}',
    ],
  },
}));
