import { describe, expect, it } from "vitest";
import {
  initialRepositorySelection,
  repositoryDetailBodyClass,
  repositoryListEmptyClass,
  repositoryListEmptyPanelClass,
  repositoryDeleteDialogContent,
  repositorySummaryItems,
  repositoryRowStateClass,
} from "./repository-page-model";
import type { Repository } from "../../api/schemas";

describe("repository page model", () => {
  it("does not preselect a repository", () => {
    expect(initialRepositorySelection([repository("debian-internal")])).toBeUndefined();
  });

  it("highlights only the selected repository row", () => {
    expect(repositoryRowStateClass("debian-internal", "debian-internal")).toContain("border-l-primary");
    expect(repositoryRowStateClass("debian-internal", "debian-internal")).not.toContain("text-primary-foreground");
    expect(repositoryRowStateClass("debian-internal", undefined)).not.toContain("border-l-primary");
  });

  it("keeps short repository details packed at the top of the scroll area", () => {
    expect(repositoryDetailBodyClass()).toContain("content-start");
    expect(repositoryDetailBodyClass()).toContain("h-full");
    expect(repositoryDetailBodyClass()).toContain("overflow-y-auto");
  });

  it("keeps the empty repository list filling its panel", () => {
    expect(repositoryListEmptyClass()).toContain("h-full");
    expect(repositoryListEmptyClass()).toContain("p-3");
    expect(repositoryListEmptyPanelClass()).toContain("h-full");
    expect(repositoryListEmptyPanelClass()).toContain("place-items-center");
    expect(repositoryListEmptyPanelClass()).toContain("border-dashed");
  });

  it("formats readonly repository summary items", () => {
    expect(repositorySummaryItems(repository("debian-internal"))).toEqual([
      ["Ecosystem", "apt"],
      ["Visibility", "private"],
      ["Created", "2026-07-22T00:00:00.000Z"],
      ["Updated", "2026-07-22T00:00:00.000Z"],
    ]);
  });

  it("builds destructive dialog copy for deleting a repository", () => {
    expect(repositoryDeleteDialogContent("debian-internal")).toEqual({
      title: "Delete repository",
      description: [
        "Delete repository debian-internal?",
        "This removes repository metadata, repository contents, artifacts, activity, and plugin-owned resources. Publish tokens scoped to this repository will be updated; tokens with no remaining repository scope will be revoked.",
      ].join("\n\n"),
      confirmLabel: "Delete repository",
      pendingLabel: "Deleting...",
      confirmationText: "debian-internal",
    });
  });
});

function repository(name: string): Repository {
  return {
    id: `repo_${name}`,
    name,
    ecosystem: "apt",
    visibility: "private",
    config: {},
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
