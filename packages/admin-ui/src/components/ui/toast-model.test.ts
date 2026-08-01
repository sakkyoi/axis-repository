import { describe, expect, it } from "vitest";
import { toastAutoDismissMs, toastDismissAfterMs, toastErrorMessage, toastSubdueAfterMs } from "./toast-model";

describe("toast model", () => {
  it("uses the shared short-lived feedback timeout", () => {
    expect(toastAutoDismissMs()).toBe(3000);
  });

  it("takes a confirmation away on its own", () => {
    expect(toastDismissAfterMs("info")).toBe(3000);
  });

  it("does not dim short-lived confirmations", () => {
    expect(toastSubdueAfterMs("info")).toBeUndefined();
  });

  it("leaves a failure for someone to close", () => {
    // It carries the only account of what went wrong, often a sentence or two
    // of it, and removing it while it is still being read is worse than never
    // having shown it.
    expect(toastDismissAfterMs("error")).toBeUndefined();
  });

  it("dims persistent messages after the reader has seen them", () => {
    expect(toastSubdueAfterMs("warning")).toBe(1500);
    expect(toastSubdueAfterMs("error")).toBe(1500);
  });

  it("makes a sentence of whatever was thrown", () => {
    expect(toastErrorMessage(new Error("upload refused"))).toBe("upload refused");
    expect(toastErrorMessage("plain text")).toBe("plain text");
    expect(toastErrorMessage({ nothing: "recognisable" })).toBe("Unexpected error");
  });
});
