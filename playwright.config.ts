import { defineConfig, devices } from '@playwright/test';

// On CI the run also writes a JUnit file and an HTML report (published as artifacts and read by
// tools/ci-summary.mjs); locally it stays the plain list.
const ci = Boolean(process.env.CI);

// No webServer on purpose: the tests open dist/index.html over file://, the way the TV loads the app.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: true,
  retries: 0,
  reporter: ci
    ? [
        ['list'],
        ['junit', { outputFile: 'reports/e2e-junit.xml' }],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : 'list',
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
