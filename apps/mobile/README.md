# apps/mobile

The Capacitor shell for iOS and Android. It bundles the same `@mazeosaur/game`
build with every asset inside the app and **no network code at all**: the
network package is not a dependency here, and CI fails the build if the
produced bundle references `fetch`, `XMLHttpRequest`, `WebSocket` or
`navigator.sendBeacon`.

Empty until milestone M3 (see [docs/00-proposal.md](../../docs/00-proposal.md)).
