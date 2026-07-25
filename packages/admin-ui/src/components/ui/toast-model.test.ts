import { describe, expect, it } from "vitest";
import { toastAutoDismissMs } from "./toast-model";

describe("toast model", () => {
  it("uses the shared short-lived feedback timeout", () => {
    expect(toastAutoDismissMs()).toBe(3000);
  });
});
