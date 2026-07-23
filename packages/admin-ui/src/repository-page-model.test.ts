import { describe, expect, it } from "vitest";
import {
  initialRepositorySelection,
  repositoryDetailBodyClass,
  repositoryRowStateClass,
} from "./repository-page-model";
import type { Repository } from "./api/schemas";

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
