import { defineConfig } from "vite";

// Empty or whitespace is a broken caller, not a commit: an explicitly empty
// `--build-arg BUILD_COMMIT=` overrides the Dockerfile's `ARG BUILD_COMMIT=dev`
// default, so `?? "dev"` alone would stamp "" and the bundle would claim a
// commit it lacks.
export function resolveBuildCommit(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : "dev";
}

export default defineConfig({
  // A local build has no BUILD_COMMIT and stamps "dev", which is honest —
  // that build is not reproducible from a registry tag. CI sets it to
  // github.sha so the string inside the bundle matches the GHCR tag that
  // shipped it. See docs/01-v1-architecture.md §2.2.
  define: {
    __BUILD_COMMIT__: JSON.stringify(resolveBuildCommit(process.env.BUILD_COMMIT)),
  },
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
        //
        // This must stay a function, not the `{ phaser: ["phaser"] }`
        // object-literal form. Vite 8 rebases its types on rolldown, whose
        // `manualChunks` type is function-only (object literals were
        // rejected with TS2769); Vite 7's are plain Rollup types, which
        // accept both. Root installs vite@8 (via vitest); apps/web pins
        // vite@7, so a real `npm ci` shadows it locally and the object
        // form happened to typecheck here — until something assembles
        // apps/web/node_modules without that per-workspace link, at which
        // point the hoisted vite@8 types take over and this file fails to
        // typecheck with no code change. The function form below
        // typechecks under both, so the shadowing no longer matters.
        manualChunks(id) {
          if (id.includes("node_modules/phaser/")) {
            return "phaser";
          }
        },
      },
    },
  },
});
