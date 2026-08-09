import { describe, expect, it } from "vitest";
import { sideDrawerBodyClass, sideDrawerContentClass } from "./side-drawer";

describe("side drawer layout", () => {
  it("keeps drawer contents clear of the bottom edge while scrolling", () => {
    expect(sideDrawerBodyClass()).toContain("overflow-y-auto");
    expect(sideDrawerBodyClass()).toContain("pb-4");
  });

  it("keeps drawer content clipping inside the panel", () => {
    expect(sideDrawerContentClass()).toContain("overflow-hidden");
  });
});
