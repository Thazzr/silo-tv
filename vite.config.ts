import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { webosHtml } from './build/webosHtml.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

export default defineConfig({
  base: './',
  plugins: [react(), webosHtml()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'chrome79',
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: { format: 'iife' },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      'scripts/**/*.test.{ts,mjs}',
      'build/**/*.test.ts',
      'tests/**/*.test.{js,ts}',
    ],
  },
});
