import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests: every main page renders without errors, on desktop and phone widths. Runs against a
 * dev server started with Supabase sign-in off (SILVERNOTE_E2E_URL to point at another server).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 2,
  use: { baseURL: process.env.SILVERNOTE_E2E_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.SILVERNOTE_E2E_URL
    ? undefined
    : {
        command: 'NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
