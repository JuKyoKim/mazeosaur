// The atlas the game loads is the one this code draws.
//
// `art:verify` compares `docs/art/*.png`, which is the record of how the
// direction was chosen, not the asset any player ever sees. `atlas.test.ts`
// next door reads the committed JSON and checks that the rectangles in it
// describe the sprites. Neither looked at the PNG, so a `sprites.ts` or
// palette change that was not followed by `npm run art:atlas` shipped pixels
// that disagreed with the code and nothing in the repo noticed: the board
// frames blit the in-memory sprite, so even a screenshot of the running game
// could not catch it.
//
// This lives in vitest rather than only in the CLI because `npm run check` is
// the gate and it does not call `art:verify`. The comparison is in
// `tools/art/atlas.ts` so that the command and the gate cannot disagree.

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assetDir, atlasDrift, atlasFiles, describeProblem } from "../atlas.js";
import { CHOSEN } from "../directions.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

describe(`${assetDir(CHOSEN.id)}`, () => {
  it("holds exactly the files the generator produces", () => {
    // Pixels for the PNG and text for the JSON — never the PNG's bytes. See
    // the header of `tools/art/png.ts`: two zlib builds emit different
    // level-9 streams for the same scanlines, so a byte diff asserts on the
    // compressor the runner happens to link.
    const problems = atlasDrift(ROOT);
    expect(problems.map(describeProblem).join("\n"), "run `npm run art:atlas` and commit the result").toBe("");
  });

  it("is checked at all, which is the part that was missing", () => {
    // A guard whose subject list came out empty would pass on everything.
    // Four files: a PNG and a JSON for the dinosaurs and for the invaders.
    const files = atlasFiles(CHOSEN);
    expect(files.map((f) => f.rel).sort()).toEqual([
      `${assetDir(CHOSEN.id)}/dinos.json`,
      `${assetDir(CHOSEN.id)}/dinos.png`,
      `${assetDir(CHOSEN.id)}/invaders.json`,
      `${assetDir(CHOSEN.id)}/invaders.png`,
    ]);
    expect(files.filter((f) => f.kind === "image").reduce((n, f) => n + (f.kind === "image" ? f.frames : 0), 0)).toBe(72);
  });
});
