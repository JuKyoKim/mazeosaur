import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// There is no caddy binary or container runtime in `npm run check`'s
// environment, so this cannot curl a running server the way ARB-267 was
// verified by hand. What it can do is pin the one fact that bug turned on:
// `route` blocks run directives in the order written, and `path` matchers
// see the REQUEST path, not the path `try_files` rewrites it to. A matcher
// placed before `try_files` never sees `/index.html` for a request to `/`
// or any other SPA-fallback route, so the header it sets never fires on the
// only path a real user loads. ARB-267 shipped exactly that ordering.
const caddyfile = readFileSync(
  fileURLToPath(new URL("../Caddyfile", import.meta.url)),
  "utf8",
);

function indexOfLine(needle: string): number {
  const index = caddyfile.indexOf(needle);
  if (index === -1) throw new Error(`Caddyfile: expected to find ${JSON.stringify(needle)}`);
  return index;
}

describe("apps/web/Caddyfile", () => {
  it("sets the no-cache header after try_files, not before", () => {
    const tryFiles = indexOfLine("try_files {path} /index.html");
    const noCacheMatcher = indexOfLine("@noCache path /index.html /sw.js /manifest.webmanifest");
    const noCacheHeader = indexOfLine('header @noCache Cache-Control "no-cache"');

    // Both lines of the @noCache rule must come after the rewrite, or a
    // request for `/` is matched before `path` ever becomes `/index.html`.
    expect(noCacheMatcher).toBeGreaterThan(tryFiles);
    expect(noCacheHeader).toBeGreaterThan(tryFiles);
  });

  it("still caches hashed assets forever", () => {
    expect(caddyfile).toContain("@immutable path /assets/*");
    expect(caddyfile).toContain(
      'header @immutable Cache-Control "public, max-age=31536000, immutable"',
    );
  });

  it("answers /healthz from a route block ordered before the SPA fallback", () => {
    const healthzRoute = indexOfLine("route /healthz {");
    const fallbackRoute = indexOfLine("route {");
    // `respond` for /healthz must run before the fallback route's
    // `try_files`, or a collapsed/reordered config would let try_files
    // rewrite /healthz to /index.html and the container HEALTHCHECK would
    // start passing on HTML instead of the literal "ok".
    expect(healthzRoute).toBeLessThan(fallbackRoute);
  });
});
