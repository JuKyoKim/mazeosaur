import { describe, expect, it } from "vitest";
import { resolveBuildCommit } from "../vite.config.js";

describe("resolveBuildCommit", () => {
  it("passes through a real commit sha", () => {
    expect(resolveBuildCommit("2ee6eb2816c483466b77986bad2af9bbd6eda96b")).toBe(
      "2ee6eb2816c483466b77986bad2af9bbd6eda96b",
    );
  });

  it("falls back to dev when unset", () => {
    expect(resolveBuildCommit(undefined)).toBe("dev");
  });

  it("falls back to dev when empty", () => {
    expect(resolveBuildCommit("")).toBe("dev");
  });

  it("falls back to dev when whitespace-only", () => {
    expect(resolveBuildCommit("  ")).toBe("dev");
  });
});
