import { describe, expect, it } from "vitest";
import {
  repositoryDetailBodyClass,
  repositoryDetailTitleClass,
  repositoryListNameCellClass,
  repositoryListNameTextClass,
  repositoryListEmptyClass,
  repositoryListEmptyPanelClass,
  repositoryDeleteDialogContent,
  repositoryKindLabel,
  repositoryListSkeletonColumns,
  repositoryListUpdatedLabel,
  repositorySummaryItems,
  repositoryRowStateClass,
} from "./repository-page-model";
import type { Repository } from "../../api/schemas";

describe("repository page model", () => {

  it("highlights only the selected repository row", () => {
    // The accent, however it is drawn: what matters is that the selected row
    // wears the primary colour and an unselected one does not, and that the
    // row does not take the foreground colour that goes with a filled surface.
    expect(repositoryRowStateClass("debian-internal", "debian-internal")).toContain("primary");
    expect(repositoryRowStateClass("debian-internal", "debian-internal")).not.toContain("text-primary-foreground");
    expect(repositoryRowStateClass("debian-internal", undefined)).not.toContain("primary");
  });

  it("keeps short repository details packed at the top of the scroll area", () => {
    expect(repositoryDetailBodyClass()).toContain("content-start");
    expect(repositoryDetailBodyClass()).toContain("min-h-0");
    expect(repositoryDetailBodyClass()).toContain("overflow-y-auto");
    expect(repositoryDetailBodyClass()).not.toContain("h-full");
  });

  it("lets long repository names fit inside the split list and detail panes", () => {
    expect(repositoryListNameCellClass()).toContain("max-w-0");
    expect(repositoryListNameTextClass()).toContain("truncate");
    expect(repositoryDetailTitleClass()).toContain("break-all");
  });

  it("keeps the empty repository list filling its panel", () => {
    expect(repositoryListEmptyClass()).toContain("h-full");
    expect(repositoryListEmptyClass()).toContain("p-3");
    expect(repositoryListEmptyPanelClass()).toContain("h-full");
    expect(repositoryListEmptyPanelClass()).toContain("place-items-center");
    expect(repositoryListEmptyPanelClass()).toContain("border-dashed");
  });

  it("keeps repository list skeleton columns aligned with the table", () => {
    expect(repositoryListSkeletonColumns()).toEqual(["w-48", "w-24", "w-14", "w-16", "w-20"]);
  });

  it("formats readonly repository summary items", () => {
    expect(repositorySummaryItems(repository("debian-internal"))).toEqual([
      ["Ecosystem", "apt"],
      ["Kind", "hosted"],
      ["Visibility", "private"],
      ["Created", "2026-07-22T00:00:00.000Z"],
      ["Updated", "2026-07-22T00:00:00.000Z"],
    ]);
  });

  it("formats repository kind labels", () => {
    expect(repositoryKindLabel("hosted")).toBe("Hosted");
    expect(repositoryKindLabel("proxy")).toBe("Proxy");
    expect(repositoryKindLabel("group")).toBe("Group");
  });

  it("formats repository list updated dates without seconds", () => {
    expect(repositoryListUpdatedLabel("2026-08-02T12:51:54.000Z")).toMatch(/8\/2\/26,? 8:51 PM|8\/2\/26,? 12:51 PM/);
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
    kind: "hosted",
    visibility: "private",
    config: {},
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
