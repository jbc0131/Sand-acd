import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production server with its own data dir, so tests never touch ./data/cda.db or the dev cache.
    command: `npm run build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/sites`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { CDA_DATA_DIR: "./data/e2e" },
  },
});
