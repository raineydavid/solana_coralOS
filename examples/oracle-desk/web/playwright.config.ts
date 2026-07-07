import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:5174',
    video: 'on', // proof artifact — a real screen recording of the app in use, not a description of it
    ...devices['Desktop Chrome'],
    // Portable by default: Playwright manages its own browser download. Set PLAYWRIGHT_EXECUTABLE_PATH
    // to reuse an already-installed Chromium/headless-shell (e.g. a sandbox provisioned out-of-band)
    // instead — same pattern as ../video/remotion.config.ts's REMOTION_BROWSER_EXECUTABLE.
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } }
      : {}),
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
