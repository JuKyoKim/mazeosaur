# syntax=docker/dockerfile:1

# --- build ---------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /repo

# Root manifests + every workspace's package.json first, so `npm ci` is
# cached across source-only changes.
COPY package.json package-lock.json ./
COPY packages/sim/package.json packages/sim/package.json
COPY packages/content/package.json packages/content/package.json
COPY packages/game/package.json packages/game/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY tsconfig.base.json vitest.config.ts bundle-budget.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/web ./apps/web

RUN npm run build --workspace apps/web \
 && node scripts/check-bundle-size.mjs \
 && find apps/web/dist -name '*.map' -delete

# --- caddy, with brotli --------------------------------------------------
# Stock Caddy ships gzip and zstd but not brotli; build it in with xcaddy
# rather than hand-compiling nginx + ngx_brotli from source.
FROM caddy:2-builder-alpine AS caddy-build
RUN xcaddy build --with github.com/ueffel/caddy-brotli

# --- serve -----------------------------------------------------------------
FROM caddy:2-alpine AS serve

COPY --from=caddy-build /usr/bin/caddy /usr/bin/caddy
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8080/healthz | grep -q ok \
   && wget -q -O- http://127.0.0.1:8080/ | grep -q 'id="game"' \
   || exit 1
