/**
 * The one shape this package needs from the bundler, declared by hand.
 *
 * `packages/game` sets `"types": []` on purpose, so it cannot pick up
 * `vite/client` and get this for free — and should not: rule 2's
 * source-level half is that nothing in here may so much as name a network
 * client, and the shell is what injects anything that talks to one.
 *
 * `atlas.ts` pulls this file in with a triple-slash reference rather than
 * leaving it to be discovered. An ambient declaration only enters a program
 * when its file does, and `apps/web` and `tests/client` both compile
 * `atlas.ts` through the workspace symlink while including no part of
 * `packages/game/src` themselves. The reference is what makes one
 * declaration serve all three typechecks instead of only this package's.
 */
declare module "*.png?url" {
  const url: string;
  export default url;
}
