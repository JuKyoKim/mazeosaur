import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    // Emitted for local debugging but not referenced from the bundle
    // (no sourceMappingURL comment) and stripped from the Docker image
    // before it ships — see apps/web/Dockerfile. Do not ship 10 MB of
    // map to a phone.
    sourcemap: "hidden",
    target: "es2022",
    rollupOptions: {
      output: {
        // Phaser barely changes between our releases; splitting it into
        // its own chunk means a content/app change doesn't bust the
        // cache for the ~290 kB gzip engine chunk.
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
  },
});
