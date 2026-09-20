# @volundr/game

The Phaser client: rendering, input, HUD, audio. It owns no game rules. It
sends commands to `@volundr/sim` and draws whatever state comes back, with
interpolation between sim ticks.

Both `apps/web` and `apps/mobile` mount this package unchanged. Platform
differences (saves, network) are injected, never imported here.

Empty until milestone M1 (see [docs/00-proposal.md](../../docs/00-proposal.md)).
