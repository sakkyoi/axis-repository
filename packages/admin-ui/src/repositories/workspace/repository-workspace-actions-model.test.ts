import { describe, expect, it } from "vitest";
import { repositoryWorkspaceActions } from "./repository-workspace-actions-model";

describe("repository workspace actions model", () => {
  it("shows repository-level publish actions only when publishing is available", () => {
    expect(repositoryWorkspaceActions({ canPublish: true }).map((action) => action.label)).toEqual([
      "Activity",
      "Publish artifact",
    ]);
    expect(repositoryWorkspaceActions({ canPublish: false }).map((action) => action.label)).toEqual([
      "Activity",
    ]);
  });
});
