import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    // The simulation must never touch a DOM. Keep the default node environment.
    environment: "node",
  },
});
