# apps/server

Small HTTP API for the web build only: save sync, daily-seed leaderboard,
replay verification (it re-runs `@mazeosaur/sim` headless on the submitted
command log and trusts nothing the client claims about its score).

Deploys as one container like any other stack in the homelab. Nothing in
the mobile apps ever talks to it.

Empty until milestone M4 (see [docs/00-proposal.md](../../docs/00-proposal.md)).
