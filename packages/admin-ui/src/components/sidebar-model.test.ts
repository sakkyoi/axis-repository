import { describe, expect, it } from "vitest";
import {
  SIDEBAR_LABELS_NEED_PX,
  readStoredSidebarChoice,
  storeSidebarChoice,
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

  it("remembers a choice between visits", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };

    storeSidebarChoice(storage, true);
    expect(readStoredSidebarChoice(storage)).toBe(true);
    storeSidebarChoice(storage, false);
    expect(readStoredSidebarChoice(storage)).toBe(false);
  });

  it("has nothing to say before anything has been chosen", () => {
    // Not the same as having chosen to keep it open: only the first leaves the
    // screen free to decide.
    const empty = { getItem: () => null };

    expect(readStoredSidebarChoice(empty)).toBeUndefined();
    expect(readStoredSidebarChoice(undefined)).toBeUndefined();
    expect(readStoredSidebarChoice({ getItem: () => "neither" })).toBeUndefined();
  });

  it("carries on when storage refuses", () => {
    // A browser with site data blocked throws on both, and a navigation panel
    // is not worth a blank page.
    const refusing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(readStoredSidebarChoice(refusing)).toBeUndefined();
    expect(() => storeSidebarChoice(refusing, true)).not.toThrow();
  });
});
