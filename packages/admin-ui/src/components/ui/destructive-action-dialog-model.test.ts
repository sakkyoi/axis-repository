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
      prompt: "min-w-0 text-sm font-medium",
      token: "mx-1 inline-flex max-w-full align-middle",
      code: "min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs",
      copyButton: "ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-transparent p-0 text-muted-foreground hover:text-foreground disabled:opacity-50",
    });
  });
});
