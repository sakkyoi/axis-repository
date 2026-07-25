import { describe, expect, it } from "vitest";
import {
  destructiveConfirmationCopyLabel,
  destructiveConfirmationLayoutClasses,
  destructiveConfirmationMatches,
} from "./destructive-action-dialog-model";

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

  it("builds an accessible label for copying confirmation text", () => {
    expect(destructiveConfirmationCopyLabel("delete object")).toBe("Copy delete object");
  });

  it("keeps confirmation prompt and copy action inline", () => {
    expect(destructiveConfirmationLayoutClasses()).toEqual({
      row: "flex min-w-0 items-center gap-2",
      prompt: "min-w-0 flex-1 text-sm font-medium",
      code: "inline-block max-w-full truncate rounded bg-muted px-1.5 py-0.5 align-bottom text-xs",
      copyButton: "h-8 w-8 shrink-0",
    });
  });
});
