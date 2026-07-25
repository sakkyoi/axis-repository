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

  it("keeps confirmation text and copy action in fixed columns", () => {
    expect(destructiveConfirmationLayoutClasses()).toEqual({
      row: "grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] items-center gap-2",
      code: "min-w-0 truncate rounded bg-muted px-2 py-1 text-xs",
      copyButton: "h-8 w-8 shrink-0",
    });
  });
});
