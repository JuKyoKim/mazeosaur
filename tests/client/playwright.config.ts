import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const webRoot = fileURLToPath(new URL("../../apps/web", import.meta.url));

/**
 * The port the harness serves on. `apps/web/vite.config.ts` pins 5173 with
 * `strictPort`, so two checkouts of this repo cannot both have a dev server
 * up on the default. Set `MAZEOSAUR_CLIENT_PORT` to run the harness while
 * another worktree holds 5173 — which is the normal case when several
 * agents share a machine.
 */
const port = Number(process.env.MAZEOSAUR_CLIENT_PORT ?? 5173);
const origin = `http://localhost:${port}`;

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
  /**
   * One worker, so a spec's own 60 s timeout measures the spec and not how
   * many other browsers are competing for the runner.
   *
   * `fullyParallel: false` only serialises *within* a file; separate spec
   * files still ran on separate workers, which on the 2-core GitHub runner
   * means each one gets half a core to drive a canvas at 60 fps. The smoke
   * spec's "full run" was finishing in 58.3 s, 57.6 s and 44.8 s against
   * that 60 s budget across three consecutive `main` runs — one second from
   * red, because of load rather than anything in the client. Adding a
   * seventh test tipped it over.
   *
   * Serially the whole suite is a few minutes, well inside `client-smoke`'s
   * 15-minute job timeout, and every spec gets the machine it is timed
   * against. Raising the per-test timeout instead would keep a number that
   * measures the runner.
   */
  workers: 1,
  forbidOnly: !!process.env.CI,
  // No retry net: these specs drive a local dev server and a local browser
  // with a pinned seed, so a failure is a real defect or a real race, not a
  // flaky third party. A retry here hid a genuine determinism-spec race
  // once, reporting it as `1 flaky, 2 passed`.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "../../playwright-report" }]] : "list",
  outputDir: "../../test-results",
  use: {
    baseURL: origin,
    viewport: { width: 720, height: 1280 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // `devices["Desktop Chrome"]` carries its own 1280x720 viewport, which
  // would otherwise replace (not merge with) the portrait viewport above —
  // Playwright resolves `use` per project, not deep-merged by key. Re-assert
  // it last so the game mounts at its real portrait aspect ratio instead of
  // being letterboxed sideways, which silently shifts every pixel coordinate
  // the tests click.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 720, height: 1280 } } }],
  webServer: {
    // Vite directly rather than `npm run dev`, because the root script
    // hops through `npm run dev --workspace apps/web` and npm eats the
    // `--port` on the way (it parses it as an npm config and passes the
    // bare number on, so vite sees `--host 5234` and binds a nonsense
    // address). Resolved from `apps/web`, so this is the vite@7 that
    // workspace pins — the same one `npm run dev` would run.
    command: `npx vite --port ${port} --strictPort`,
    cwd: webRoot,
    url: origin,
    // Never reuse a server this run did not start. A dev server already on
    // this port is serving *some* checkout, and on a machine where several
    // worktrees of this repo are live that is routinely not the one under
    // test — which makes the harness pass against code it never loaded.
    // Vite's `strictPort` then fails loudly on a busy port, which is the
    // outcome we want.
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
