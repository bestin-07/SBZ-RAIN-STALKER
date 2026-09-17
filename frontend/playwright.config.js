import { defineConfig, devices } from '@playwright/test'

// Compat/PWA regression suite (see tests/e2e/*.spec.js).
//
// Runs against the LOCAL dev server only — never gemmaraus.at, and never lets
// a page make a real call to api.open-meteo.com / dataset.api.hub.geosphere.at.
// CLAUDE.md's own "API quota — HARD RULE" exists because probing those hosts
// from this machine's IP shares the live app's per-IP quota and once bricked
// it; an automated suite that re-runs on every CI push would burn through
// that same quota far faster than a human ever would. Tests that need a
// signed-in-with-location app state stub the relevant network calls instead
// of hitting the real weather APIs.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'Desktop Chrome',  use: { ...devices['Desktop Chrome'] } },
    { name: 'Desktop Firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'Desktop Safari',  use: { ...devices['Desktop Safari'] } },
    // WebKit engine stands in for iOS Safari's rendering/CSS behaviour
    // (dvh, mask-image, env(safe-area-*), prefers-reduced-motion). It does
    // NOT stand in for iOS PWA/standalone-mode behaviour, Low Power Mode
    // throttling, bfcache specifics, or the installed-app status bar — see
    // the manual checklist in the audit report for those.
    { name: 'Mobile Safari (iPhone 14)', use: { ...devices['iPhone 14'] } },
    { name: 'Mobile Safari (iPhone SE)', use: { ...devices['iPhone SE'] } },  // small/notch-less floor device
    { name: 'Mobile Chrome (Pixel 7)',   use: { ...devices['Pixel 7'] } },
  ],
})
