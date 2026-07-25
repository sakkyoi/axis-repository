import { describe, expect, it } from "vitest";
import { clipboardCopiedResetMs } from "./copy-feedback-model";

describe("copy feedback model", () => {
  it("uses one copied feedback reset delay across copy controls", () => {
    expect(clipboardCopiedResetMs()).toBe(1500);
  });
});
