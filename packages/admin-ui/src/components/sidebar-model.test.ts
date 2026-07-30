import { describe, expect, it } from "vitest";
import {
  SIDEBAR_LABELS_NEED_PX,
  sidebarCollapsed,
  sidebarStartsCollapsed,
  sidebarToggleLabel,
  sidebarWidthPx,
} from "./sidebar-model";

describe("sidebar", () => {
  it("starts collapsed where the labels cost more than they are worth", () => {
    expect(sidebarStartsCollapsed(SIDEBAR_LABELS_NEED_PX - 1)).toBe(true);
    expect(sidebarStartsCollapsed(SIDEBAR_LABELS_NEED_PX)).toBe(false);
  });

  it("follows the screen until somebody says otherwise", () => {
    expect(sidebarCollapsed({ viewportWidth: 800 })).toBe(true);
    expect(sidebarCollapsed({ viewportWidth: 1600 })).toBe(false);
  });

  it("keeps a choice through a resize that would have decided differently", () => {
    // Having been told, guessing again is worse than not guessing: a window
    // dragged narrower must not take back what someone opened on purpose.
    expect(sidebarCollapsed({ chosen: false, viewportWidth: 600 })).toBe(false);
    expect(sidebarCollapsed({ chosen: true, viewportWidth: 1900 })).toBe(true);
  });

  it("gives the labels room only when they are shown", () => {
    expect(sidebarWidthPx(false)).toBeGreaterThan(sidebarWidthPx(true));
  });

  it("names what the control will do, not what it is", () => {
    expect(sidebarToggleLabel(true)).toBe("Expand navigation");
    expect(sidebarToggleLabel(false)).toBe("Collapse navigation");
  });
});
