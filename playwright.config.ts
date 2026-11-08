import { defineConfig, devices } from '@playwright/test';

// No webServer on purpose: the tests open dist/index.html over file://, the way the TV loads the app.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  forbidOnly: true,
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
