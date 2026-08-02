import { describe, expect, it } from "vitest";
import { DETAIL_PANE_NEEDS_PX, detailPaneFitsBeside, listDetailGridClass } from "./list-detail-model";

describe("a list and what is selected in it", () => {
  it("puts them side by side only where both fit", () => {
    expect(detailPaneFitsBeside(DETAIL_PANE_NEEDS_PX)).toBe(true);
    expect(detailPaneFitsBeside(DETAIL_PANE_NEEDS_PX - 1)).toBe(false);
  });

  it("gives the list the whole width when the pane cannot sit beside it", () => {
    // Not a second row: stacking split the height between them, so the list
    // was squeezed into half a screen to make room for a pane that says
    // nothing until something is picked.
    expect(listDetailGridClass(false)).not.toContain("grid-cols");
    expect(listDetailGridClass(true)).toContain("grid-cols");
  });

  it("lets split panes keep their own scroll areas", () => {
    expect(listDetailGridClass(true)).toContain("min-h-0");
  });
});
