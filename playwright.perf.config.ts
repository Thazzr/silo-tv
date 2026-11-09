import { defineConfig, devices } from '@playwright/test';

// The local scroll profiling harness (npm run perf:scroll). Not part of the gate: it measures, it
// does not assert. It loads the unminified dist-perf/ build over file://, like the TV does.
export default defineConfig({
  testDir: 'e2e/perf',
  testMatch: '*.perf.ts',
  timeout: 300_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    viewport: { width: 1920, height: 1080 },
    locale: 'de-DE',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
});
