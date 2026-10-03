import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Drives the real client (Vite dev server, real Phaser build) headlessly.
 * Deliberately not a vitest project: these tests boot a browser and a dev
 * server, so they live outside `npm test` and `packages/sim`'s under-a-second
 * budget. Run with `npm run test:client`.
 */
export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // one dev server, one port; keep it simple
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]] : "list",
  outputDir: "../../test-results",
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 720, height: 1280 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    cwd: repoRoot,
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
