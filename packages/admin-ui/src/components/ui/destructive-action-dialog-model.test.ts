import { describe, expect, it } from "vitest";
import { destructiveConfirmationMatches } from "./destructive-action-dialog-model";

describe("destructive action dialog model", () => {
  it("requires exact confirmation text after trimming surrounding whitespace", () => {
    expect(destructiveConfirmationMatches("github-actions", "github-actions")).toBe(true);
    expect(destructiveConfirmationMatches(" github-actions ", "github-actions")).toBe(true);
    expect(destructiveConfirmationMatches("GitHub-Actions", "github-actions")).toBe(false);
    expect(destructiveConfirmationMatches("github", "github-actions")).toBe(false);
  });

  it("keeps confirmation optional when no target text is configured", () => {
    expect(destructiveConfirmationMatches("", undefined)).toBe(true);
    expect(destructiveConfirmationMatches("anything", undefined)).toBe(true);
  });
});
