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
      code: "inline-flex min-w-0 cursor-pointer items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/80 disabled:cursor-default disabled:opacity-50",
      text: "min-w-0 truncate",
      copyButton: "ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground",
    });
  });
});
