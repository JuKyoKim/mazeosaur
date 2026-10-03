# apps/web

The browser build: a Vite shell that mounts `@mazeosaur/game` and serves
as static files. Everything the game needs to be playable is in the
bundle. `apps/server` adds cloud saves, a daily-seed leaderboard and
replay verification on top of a game that is complete without them —
the server is additive, never required.

```bash
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

Open it on a phone over the LAN to feel the mazing; that is what the
prototype is for.

## What the shell owns

It is deliberately thin. The shell is the only place in the web target
that touches the browser, because `@mazeosaur/game` takes its platform
services as injected ports (see section 2 of
[docs/01-v1-architecture.md](../../docs/01-v1-architecture.md)).

In `src/main.ts` today:

- **The seed.** `?seed=123` pins a run so a bug reproduces exactly;
  otherwise every run is fresh. The game package has no source of
  randomness of its own, so seed policy lives here.
- **The offline cache.** A service worker, registered in production builds
  only. It caches the app shell, so a dropped connection mid-migration
  changes nothing; the game itself needs no network once the page has
  loaded. A failed registration is swallowed on purpose — it costs this
  session's cache and nothing else.
- **Save storage**, in `src/save-store.ts`. IndexedDB, database
  `mazeosaur`, object store `save`, key `default`, with one backup slot
  for a record that fails to load. `main.ts` reads the raw record and
  runs `@mazeosaur/sim`'s `loadSave` *before* calling `mountGame`, so no
  scene does async work in `create()`. A save from a newer build gets a
  `NULL_SAVE_STORE` for the rest of the session instead of the real
  store, so nothing here can clobber it.
- **Lifecycle**, `wireSuspend` in `src/main.ts`. `visibilitychange` ->
  hidden and `pagehide` both call `GameHandle.suspend()`, because the OS
  can kill a backgrounded tab without warning and `pagehide` is the one
  of the two iOS Safari sometimes skips `visibilitychange` for.

Specified in section 2 and not written yet:

- **The network client**, if `apps/server` ever exists. It is injected as
  `NetPort`, no shell passes one in v1, and the mobile shell never will.
  Nothing under `packages/game` may import it.

## Serving it

Static files behind one container, deployed by the same path as every
other homelab stack. Anything that needs hands on the homelab — the
container, DNS, a certificate, the reverse proxy — is Platform and Edge
work, routed by Odin; it is not decided in a pull request here.
