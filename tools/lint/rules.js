// Lint config. This exists for one reason: to turn the repo's five rules
// from review habits into build failures. It is not a style linter — there
// is no formatting rule here and no stylistic plugin. Every rule below
// corresponds to a rule in CLAUDE.md and says which one.
//
// Run with `npm run lint`. It is part of `npm run check` and of CI.
import tsParser from "@typescript-eslint/parser";

/**
 * `Math` functions whose results are implementation-defined. IEEE-754
 * pins `+ - * / sqrt` and the integer helpers exactly, so two engines
 * agree on them forever; it says nothing about the transcendentals, and
 * V8, JavaScriptCore and the Android WebView have historically differed
 * in the last bits. One differing bit in a damage number is a diverged
 * replay. Where the sim needs a curve it uses a lookup table or an
 * integer loop (see `hpCurve` in @mazeosaur/content).
 *
 * `Math.random` is here for a different reason: a run must be a function
 * of its seed. Use the `Rng` that is passed in.
 */
const INEXACT_MATH = [
  "random",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "asinh",
  "acosh",
  "atanh",
  "pow",
  "exp",
  "expm1",
  "log",
  "log1p",
  "log2",
  "log10",
  "cbrt",
  "hypot",
];

const mathBan = INEXACT_MATH.map((property) => ({
  object: "Math",
  property,
  message:
    property === "random"
      ? "The sim is a function of (seed, content, command log). Use the Rng that is passed in."
      : `Math.${property} is not exact across JS engines, so it diverges replays. Use a lookup table or an integer loop.`,
}));

/**
 * Globals that make a result depend on something other than (seed,
 * content, command log): the clock, a scheduler, the host, the network.
 */
const IMPURE_GLOBALS = [
  { name: "Date", message: "The sim has no clock. Everything that advances takes a tick." },
  { name: "performance", message: "The sim has no clock. Everything that advances takes a tick." },
  { name: "setTimeout", message: "The sim has no timers. The caller decides when to tick()." },
  { name: "setInterval", message: "The sim has no timers. The caller decides when to tick()." },
  { name: "setImmediate", message: "The sim has no timers. The caller decides when to tick()." },
  { name: "queueMicrotask", message: "The sim is synchronous: commands in, state out." },
  { name: "requestAnimationFrame", message: "The sim does not know about frames. The renderer does." },
  { name: "window", message: "The sim has no DOM." },
  { name: "document", message: "The sim has no DOM." },
  { name: "navigator", message: "The sim has no host." },
  { name: "location", message: "The sim has no host." },
  { name: "localStorage", message: "The sim has no I/O. Saving is the shell's job, through SaveStore." },
  { name: "sessionStorage", message: "The sim has no I/O. Saving is the shell's job, through SaveStore." },
  { name: "indexedDB", message: "The sim has no I/O. Saving is the shell's job, through SaveStore." },
  { name: "crypto", message: "The sim has no entropy source other than its seed. Use the Rng." },
  { name: "process", message: "The sim runs identically in a WebView and in Node; it cannot read either." },
  { name: "fetch", message: "The sim has no I/O." },
  { name: "XMLHttpRequest", message: "The sim has no I/O." },
  { name: "WebSocket", message: "The sim has no I/O." },
  { name: "EventSource", message: "The sim has no I/O." },
];

/** Rule 2: nothing a mobile build includes may be able to reach the network. */
const NETWORK_IMPORT_BAN = {
  paths: [
    {
      name: "@mazeosaur/net",
      message:
        "Rule 2: mobile has no network. The network client is injected by the web shell through NetPort; it is never imported.",
    },
  ],
  patterns: [
    {
      group: ["**/net/*", "**/net/**", "@mazeosaur/net/*"],
      message:
        "Rule 2: mobile has no network. The network client is injected by the web shell through NetPort; it is never imported.",
    },
  ],
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "apps/mobile/ios/**",
      "apps/mobile/android/**",
      "tools/**/dist/**",
    ],
  },

  // One parser for everything. No type-aware rules: every rule here is
  // syntactic, which keeps the lint under a second like the tests.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.mjs"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { project: false },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
  },

  // Rule 1: the sim is pure. @mazeosaur/content is held to the same bar
  // because the sim reads its numbers, so a curve computed with Math.pow
  // in content diverges a replay exactly as one in the sim would.
  {
    files: ["packages/sim/src/**/*.ts", "packages/content/src/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...mathBan],
      "no-restricted-globals": ["error", ...IMPURE_GLOBALS],
      "no-restricted-syntax": [
        "error",
        {
          // `a ** b` is Math.pow with nicer spelling and the same hazard.
          selector: "BinaryExpression[operator='**']",
          message: "`**` is not exact across JS engines, so it diverges replays. Use an integer loop.",
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message: "`**=` is not exact across JS engines, so it diverges replays. Use an integer loop.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            ...NETWORK_IMPORT_BAN.paths,
            { name: "phaser", message: "Rule 1: the sim has no engine. Phaser belongs to @mazeosaur/game." },
            { name: "@mazeosaur/game", message: "Rule 1: the sim does not know a renderer exists." },
          ],
          patterns: [
            ...NETWORK_IMPORT_BAN.patterns,
            {
              group: ["node:*", "fs", "fs/*", "path", "os", "crypto", "http", "https", "worker_threads"],
              message: "Rule 1: the sim has no I/O. It must run unchanged in a WebView.",
            },
          ],
        },
      ],
    },
  },

  // Rule 2, at the source level rather than in the bundle: neither the
  // game package nor the mobile shell may name a network client. The
  // bundle-level proof is in docs/01-v1-architecture.md section 3.
  {
    files: ["packages/game/src/**/*.ts", "apps/mobile/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", NETWORK_IMPORT_BAN],
    },
  },

  // The scene-restart rule. Phaser scenes are singletons per key:
  // `scene.restart()` and `scene.start()` re-run create() on the *same*
  // object. A field initialised at its declaration therefore gets that
  // value once, at construction, and never again — so on the second run
  // it still holds the first run's value, and if that value is a display
  // object it has been destroyed, the next draw throws, and the canvas
  // freezes. That happened once already (commit 1ae3419).
  //
  // The rule is the simplest one with no gap: **an instance field of a
  // scene is declared, not initialised.** Declare it with `!` or `| null`
  // and give it its first value in init() or create(), which run on every
  // start. Static fields are per class, not per run, so they are exempt;
  // anything that wants to be a shared constant belongs in theme.ts.
  {
    files: ["packages/game/src/**/*Scene.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "PropertyDefinition[static=false][value!=null]",
          message:
            "A scene field is declared, not initialised: give it its first value in init() or create(). scene.restart() re-runs create() on the same instance, so an initialiser here runs once ever and the field carries the previous run's value — a destroyed display object, and a frozen canvas.",
        },
      ],
    },
  },
];
