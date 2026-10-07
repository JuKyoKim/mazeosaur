---
date: 2026-10-06
status: decided
---

# The client reaches its atlases through the bundler: the PNG by URL, the JSON by value

The three atlases stay exactly where `npm run art:atlas` writes them —
`packages/game/assets/toy-box/{dinos,invaders,strikes}.{png,json}`, section 5.5
of [../01-art-hud-and-audio.md](../01-art-hud-and-audio.md) — and the client
reaches them by **importing them from inside `packages/game/src`**. Nothing is
copied into `apps/web/public/`, and no shell passes an asset path in.

Each atlas is two imports with two different jobs:

```ts
import strikesPng from "../assets/toy-box/strikes.png?url"; // a URL the bundler emits
import strikes from "../assets/toy-box/strikes.json";       // the frames and `meta`, by value

this.load.atlas("strikes", strikesPng, strikes);
```

The PNG is a file: `?url` makes the bundler emit it with a content hash and
hand the code the URL it ended up at. The JSON is data: it is an ordinary
module import, and Phaser's `load.atlas` takes the parsed object in the
`atlasURL` position (`object | string`) rather than a second URL to fetch.

Two small things the import needs, both in `packages/game`: an ambient
`declare module "*.png?url"` beside the source, because the package sets
`"types": []` on purpose and must not take a dependency on `vite/client`; and
`resolveJsonModule` in its `tsconfig.json`. Without the first, `tsc -p
packages/game` fails with TS2307 on the asset import.

**One module in `@mazeosaur/game` owns the three keys**, not one import per
scene, so a scene's `preload()` is one call and `meta` is read in one place.
The loading path is written for all three atlases even when only the strikes
are drawn first: the dinosaurs and the invaders are flat `Graphics` today, and
what decides when they change is art work, not a second loading path.

**Where `meta` comes from is part of this.** `authored`, `cell` and
`drawCells` are read off the imported JSON and never retyped as constants.
5.5's two traps — the boss and the strike, where the frame's own 128 is not
the denominator — are both mistakes about a number that is in `meta` precisely
so the client does not have to know it.

**Why.**

The service worker is the whole argument. `apps/web/public/sw.js` serves
`cache-first` for `/assets/`, the manifest and the icons, and nothing else; a
file copied to `public/toy-box/strikes.png` matches none of those rules, so it
is never cached, and the first migration played offline draws no art while the
shell it is drawn in loads fine. That is the exact failure the service worker
exists to prevent. A bundler-emitted asset lands in `/assets/` and is covered
with no change to `sw.js`.

The hash is the second half of it. The atlas is byte-asserted against the
generator by `tools/art/test/assets.test.ts`, so regenerating it is a routine
event; under a fixed name in `public/` a browser can pair a cached old atlas
with a new bundle, and the symptom is frames that are subtly wrong rather than
an error. An immutable `/assets/strikes-<hash>.png` cannot do that.

For mobile it is also the cheaper proof. Capacitor ships the web build's
output, so an asset in the module graph is in the app bundle by construction —
and §3's layer 1 asserts on Rollup's own `chunk.modules`, which an asset import
is part of and a hand-copied file is not. Layer 4 wraps `XMLHttpRequest` to
throw on anything that is not same-origin: a bundler-emitted URL is a relative
read off `capacitor://localhost` and passes, which is the case that wrapper was
written for. A path assembled at runtime from a string is the case it would
reject, and would reject in QA rather than in review.

Taking the JSON by value rather than by URL buys the `meta` contract at compile
time: `strikes.meta.authored` is a typed number, and a typo is a type error.
Through the loader it arrives from `this.cache.json.get()` as `any`, in the one
part of this file where being wrong about a number is invisible until somebody
looks at the board. It also removes three loader requests, which on a phone are
three file reads before the first frame.

Measured on the real build, with all three atlases wired in: the app chunk goes
from 20,961 to 22,303 bytes gzip, or +1.3 kB against the 60 kB budget in
`bundle-budget.json`; the same atlases taken as six URLs leave the chunk at
21,105 bytes and emit three more files. 1.3 kB is what the typed `meta` and the
three saved requests cost, and that is a good price.

**What this leaves broken, deliberately.** `scripts/check-bundle-size.mjs`
reads only `.js` out of `apps/web/dist/assets`, so the 70 kB of PNG this puts
in the build is invisible to the gate that exists to catch exactly that. The
budget groups need an asset group and the script needs to stop filtering on
extension; it is release's, not a reason to hold the art.

**Rejected.**

- *Copy the atlases into `apps/web/public/`.* It is what a throwaway probe
  does, and it survives into a shipped build looking fine: unhashed, uncached
  by the service worker, a second copy of files whose bytes a test asserts, and
  invisible to every one of §3's four layers. It also has to be copied again,
  by hand or by a script, for `apps/mobile`.
- *Take the JSON by `?url` too and let Phaser fetch it.* Saves 1.2 kB gzip in
  the app chunk and costs the typed `meta` and three requests. The `meta` block
  is a contract between `tools/art` and the client, and a contract read through
  `any` is a convention again.
- *Inline the PNGs as base64 data URLs.* About 96 kB of base64 in a chunk
  budgeted at 60 kB, for bytes that gzip worse as text than the PNG does as a
  file, to remove reads that are local on every platform. The bundler's
  `assetsInlineLimit` already puts these three well over the threshold, and
  that default is right.
- *Add a fourth platform port that resolves asset URLs.* Section 2's ports
  exist for the things that genuinely differ per platform — storage, audio, and
  on web only the network client. Resolving an asset does not differ: both
  shells bundle the same package, and the bundler is the thing whose job this
  is. A port here would add an injection point that cannot fail differently on
  the two platforms, and one more thing a shell can forget to pass.
