import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `tools/` ships nothing, but the art guard in CI trusts the PNG decoder
    // in `tools/art/png.ts` to tell a changed frame from a recompressed one.
    // A decoder that is wrong towards "equal" would disable that guard
    // silently, so it is tested like shipping code.
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts"],
    // The simulation must never touch a DOM. Keep the default node environment.
    environment: "node",
  },
});
