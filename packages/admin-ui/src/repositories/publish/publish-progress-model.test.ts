import { describe, expect, it } from "vitest";
import { publishSteps, uploadFileLabel, uploadPercent } from "./publish-progress-model";

function states(steps: ReturnType<typeof publishSteps>) {
  return steps.map((step) => step.state);
}

describe("publish steps", () => {
  it("marks what is done, what is running, and what has not started", () => {
    expect(states(publishSteps({ phase: "uploading" }))).toEqual(["done", "active", "pending", "pending"]);
  });

  it("has nothing running before a publish begins", () => {
    expect(states(publishSteps({ phase: "idle" }))).toEqual(["pending", "pending", "pending", "pending"]);
  });

  it("finishes every step when the publish finishes", () => {
    expect(states(publishSteps({ phase: "published" }))).toEqual(["done", "done", "done", "done"]);
  });

  it("shows which step a failure stopped at", () => {
    // The whole reason for the list: a failure message says what went wrong,
    // and only the step it stopped at says whether the artifact was stored.
    expect(states(publishSteps({ phase: "idle", failedAt: "verifying" })))
      .toEqual(["done", "done", "failed", "pending"]);
  });

  it("does not report a failure as still running", () => {
    // The flow puts the phase back to idle when it throws, so a list drawn
    // from the phase alone would show a publish that had never started.
    const steps = publishSteps({ phase: "idle", failedAt: "uploading" });

    expect(steps.some((step) => step.state === "active")).toBe(false);
    expect(steps[1]?.state).toBe("failed");
  });
});

describe("upload progress", () => {
  it("reads as a percentage of the file", () => {
    expect(uploadPercent({ loaded: 50, total: 200, fileNumber: 1, fileCount: 1 })).toBe(25);
  });

  it("has no percentage when there is no total to divide by", () => {
    // A bar that cannot measure must not look finished, so the caller gets
    // nothing rather than a number it would have to invent.
    expect(uploadPercent({ loaded: 50, fileNumber: 1, fileCount: 1 })).toBeUndefined();
    expect(uploadPercent(undefined)).toBeUndefined();
  });

  it("never exceeds the whole of it", () => {
    expect(uploadPercent({ loaded: 300, total: 200, fileNumber: 1, fileCount: 1 })).toBe(100);
  });

  it("counts the files only when there is more than one", () => {
    expect(uploadFileLabel({ loaded: 0, total: 1, fileNumber: 1, fileCount: 1 })).toBeUndefined();
    expect(uploadFileLabel({ loaded: 0, total: 1, fileNumber: 2, fileCount: 3 })).toBe("file 2 of 3");
  });
});
