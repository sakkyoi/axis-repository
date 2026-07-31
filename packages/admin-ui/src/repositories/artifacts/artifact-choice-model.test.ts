import { describe, expect, it } from "vitest";
import { CHOICES_SHOWN, moreChoicesLabel, visibleChoices } from "./artifact-choice-model";

function options(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `v${index}`);
}

function shownOf(input: { options: string[]; selected: string; expanded?: boolean }) {
  return visibleChoices({
    options: input.options,
    isSelected: (option) => option === input.selected,
    expanded: input.expanded ?? false,
  });
}

describe("how many choices to show", () => {
  it("shows them all while they read as a row", () => {
    const all = options(CHOICES_SHOWN);

    expect(shownOf({ options: all, selected: "v0" })).toEqual({ shown: all, hidden: 0 });
  });

  it("holds the rest back once there are too many", () => {
    const result = shownOf({ options: options(30), selected: "v0" });

    expect(result.shown).toHaveLength(CHOICES_SHOWN);
    expect(result.hidden).toBe(30 - CHOICES_SHOWN);
  });

  it("keeps the chosen one on screen when it is further down", () => {
    // A row with nothing marked reads as nothing having been chosen, rather
    // than as the choice being out of sight.
    const result = shownOf({ options: options(30), selected: "v25" });

    expect(result.shown).toContain("v25");
    expect(result.shown).toHaveLength(CHOICES_SHOWN);
    expect(result.hidden).toBe(30 - CHOICES_SHOWN);
  });

  it("keeps the order the choices came in", () => {
    // The order is what makes a version list readable; moving the selected one
    // to the front to keep it visible would cost more than it saves.
    const result = shownOf({ options: options(30), selected: "v25" });

    expect(result.shown.slice(0, CHOICES_SHOWN - 1)).toEqual(options(CHOICES_SHOWN - 1));
  });

  it("shows everything once asked to", () => {
    const all = options(30);

    expect(shownOf({ options: all, selected: "v0", expanded: true })).toEqual({ shown: all, hidden: 0 });
  });

  it("says how many are waiting", () => {
    expect(moreChoicesLabel(22)).toBe("22 more");
  });
});
