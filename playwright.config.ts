import { defineConfig, devices } from '@playwright/test'

const reuseExisting = !process.env.CI
const apiPort = process.env.PLAYWRIGHT_API_PORT || '8008'
const dashboardPort = process.env.PLAYWRIGHT_DASHBOARD_PORT || '5184'
const messengerPort = process.env.PLAYWRIGHT_MESSENGER_PORT || '5185'
const apiBase = `http://127.0.0.1:${apiPort}`
const dashboardBase = `http://127.0.0.1:${dashboardPort}`
const messengerBase = `http://127.0.0.1:${messengerPort}`

const apiCommand =
  process.platform === 'win32'
    ? 'uv run python scripts/run_e2e_api.py'
    : 'uv run python scripts/run_e2e_api.py'

export default defineConfig({
  testDir: './e2e',
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'dashboard-bokito',
      testMatch: 'dashboard-bokito.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PLAYWRIGHT_DASHBOARD_URL || dashboardBase,
      },
    },
    {
      name: 'messenger',
      testMatch: 'messenger.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.PLAYWRIGHT_MESSENGER_URL || messengerBase,
      },
    },
  ],
  webServer: [
    {
      command: apiCommand,
      cwd: 'apps/api',
      url: `${apiBase}/api/health`,
      reuseExistingServer: reuseExisting,
      timeout: 120000,
      env: {
        PORT: apiPort,
      },
    },
    {
      command: `npm run dev -w bokito-dashboard -- --host 127.0.0.1 --port ${dashboardPort}`,
      url: dashboardBase,
      reuseExistingServer: reuseExisting,
      timeout: 120000,
      env: {
        VITE_API_MODE: 'bokito',
        VITE_BOKITO_API_URL: apiBase,
      },
    },
    {
      command: `npm run dev -w bokito-messenger -- --host 127.0.0.1 --port ${messengerPort}`,
      url: messengerBase,
      reuseExistingServer: reuseExisting,
      timeout: 120000,
      env: {
        VITE_BOKITO_API_URL: apiBase,
      },
    },
  ],
})
