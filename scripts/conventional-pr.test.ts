import { describe, expect, it } from "vitest";

import {
  labelsForConventionalTitle,
  parseConventionalTitle,
} from "./conventional-pr.mjs";

describe("parseConventionalTitle", () => {
  it("accepts titles without a scope", () => {
    expect(parseConventionalTitle("fix: repair publish dialog")).toMatchObject({
      ok: true,
      type: "fix",
      scope: null,
      breaking: false,
    });
  });

  it("accepts scoped breaking titles", () => {
    expect(
      parseConventionalTitle("feat(core)!: change plugin contract"),
    ).toMatchObject({
      ok: true,
      type: "feat",
      scope: "core",
      breaking: true,
    });
  });

  it("rejects unsupported types", () => {
    expect(parseConventionalTitle("release: ship v0.1.0")).toMatchObject({
      ok: false,
    });
  });
});

describe("labelsForConventionalTitle", () => {
  it("maps features to feature and minor labels", () => {
    expect(labelsForConventionalTitle("feat: add repository browser").labels).toEqual([
      "type/feature",
      "release/minor",
    ]);
  });

  it("maps dependency chores to dependency and patch labels", () => {
    expect(labelsForConventionalTitle("chore(deps): update actions").labels).toEqual([
      "type/dependencies",
      "release/patch",
    ]);
  });

  it("keeps docs and ci changes in release notes by default", () => {
    expect(labelsForConventionalTitle("docs: update release process").labels).toEqual([
      "type/documentation",
      "release/patch",
    ]);
    expect(labelsForConventionalTitle("ci: update release workflow").labels).toEqual([
      "type/maintenance",
      "release/patch",
    ]);
  });

  it("skips internal maintenance changes by default", () => {
    expect(labelsForConventionalTitle("chore: tidy release docs").labels).toEqual([
      "type/maintenance",
      "release/skip",
    ]);
    expect(labelsForConventionalTitle("refactor: simplify label mapping").labels).toEqual([
      "type/maintenance",
      "release/skip",
    ]);
  });

  it("maps breaking changes to impact and major labels", () => {
    expect(
      labelsForConventionalTitle("feat(core)!: change plugin contract").labels,
    ).toEqual(["type/feature", "impact/breaking", "release/major"]);
  });
});
