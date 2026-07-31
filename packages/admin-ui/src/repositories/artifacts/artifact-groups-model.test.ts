import { describe, expect, it } from "vitest";
import {
  artifactVariantLabel,
  artifactVersionCountLabel,
  artifactsForVersion,
  groupArtifactsByFamily,
} from "./artifact-groups-model";
import type { RepositoryArtifact } from "../../api/schemas";

function artifact(input: Partial<RepositoryArtifact> & { id: string }): RepositoryArtifact {
  return {
    repositoryName: "debian-internal",
    ecosystem: "apt",
    identity: input.id,
    name: "herald",
    summary: "herald 0.2.9 arm64",
    objectKeys: ["pool/main/h/herald/herald_0.2.9_arm64.deb"],
    metadata: {},
    publishedAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
    ...input,
  };
}

describe("grouping artifacts", () => {
  it("gathers the versions of one thing into one row", () => {
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "apt:main:herald:arm64", version: "0.2.9", summary: "herald 0.2.9 arm64" }),
      artifact({ id: "b", family: "apt:main:herald:arm64", version: "0.2.8", summary: "herald 0.2.8 arm64" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.versions).toEqual(["0.2.9", "0.2.8"]);
  });

  it("takes the highest version as the one to show", () => {
    // Not the first of them: a rebuild stamps every artifact with the same
    // timestamp, and the list then falls back to sorting by id, which put
    // 0.1.0 at the top of a package whose latest was 0.2.9.
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "apt:main:herald:arm64", version: "0.1.0" }),
      artifact({ id: "b", family: "apt:main:herald:arm64", version: "0.2.9" }),
      artifact({ id: "c", family: "apt:main:herald:arm64", version: "0.2.8" }),
    ]);

    expect(groups[0]?.latest.version).toBe("0.2.9");
    expect(groups[0]?.versions).toEqual(["0.2.9", "0.2.8", "0.1.0"]);
  });

  it("orders versions numerically rather than as text", () => {
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "f", version: "0.9" }),
      artifact({ id: "b", family: "f", version: "0.10" }),
    ]);

    expect(groups[0]?.latest.version).toBe("0.10");
  });

  it("keeps the builds of one version together under one package", () => {
    // A package exists for several architectures; it is not one package per
    // architecture, which is how apt itself describes it.
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "apt:main:herald", version: "0.2.9", summary: "herald 0.2.9 arm64" }),
      artifact({ id: "b", family: "apt:main:herald", version: "0.2.9", summary: "herald 0.2.9 amd64" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.versions).toEqual(["0.2.9"]);
    expect(artifactsForVersion(groups[0]!, "0.2.9").map(artifactVariantLabel)).toEqual(["amd64", "arm64"]);
  });

  it("counts a version once however many builds it has", () => {
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "apt:main:herald", version: "0.2.9", summary: "herald 0.2.9 arm64" }),
      artifact({ id: "b", family: "apt:main:herald", version: "0.2.9", summary: "herald 0.2.9 amd64" }),
      artifact({ id: "c", family: "apt:main:herald", version: "0.2.8", summary: "herald 0.2.8 arm64" }),
    ]);

    expect(artifactVersionCountLabel(groups[0]!)).toBe("2 versions");
  });

  it("names what tells two builds of one version apart", () => {
    expect(artifactVariantLabel(artifact({ id: "a", version: "0.2.9", summary: "herald 0.2.9 arm64" }))).toBe("arm64");
    // pypi says nothing beyond the name and the version, and there is then
    // nothing to choose between.
    expect(artifactVariantLabel(artifact({ id: "b", name: "axis", version: "1.0.0", summary: "axis 1.0.0" })))
      .toBeUndefined();
  });

  it("gathers versions that were published apart", () => {
    // The list is ordered by when things were published, so another package
    // publishing in between is what usually separates two versions.
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "apt:main:herald:arm64", version: "0.2.9" }),
      artifact({ id: "b", family: "apt:main:other:arm64", name: "other", version: "1.0.0", summary: "other 1.0.0 arm64" }),
      artifact({ id: "c", family: "apt:main:herald:arm64", version: "0.2.8" }),
    ]);

    expect(groups.map((group) => group.versions.length)).toEqual([2, 1]);
  });

  it("leaves an artifact with no family standing on its own", () => {
    // Nothing is grouped on a guess: a plugin that has not said which of its
    // artifacts belong together does not get one invented for it.
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", version: "1" }),
      artifact({ id: "b", version: "2" }),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("counts versions only when there is more than one", () => {
    const [single] = groupArtifactsByFamily([artifact({ id: "a", family: "f", version: "1" })]);
    const [many] = groupArtifactsByFamily([
      artifact({ id: "a", family: "f", version: "2" }),
      artifact({ id: "b", family: "f", version: "1" }),
    ]);

    expect(artifactVersionCountLabel(single!)).toBeUndefined();
    expect(artifactVersionCountLabel(many!)).toBe("2 versions");
  });

  it("orders the builds of a version by name rather than by chance", () => {
    // Two builds of one version are equal in the version ordering, so whatever
    // order they come out of storage in is what the chips would take -- and it
    // moves between visits.
    const groups = groupArtifactsByFamily([
      artifact({ id: "a", family: "f", version: "1.0", summary: "herald 1.0 riscv64" }),
      artifact({ id: "b", family: "f", version: "1.0", summary: "herald 1.0 amd64" }),
      artifact({ id: "c", family: "f", version: "1.0", summary: "herald 1.0 arm64" }),
    ]);

    expect(artifactsForVersion(groups[0]!, "1.0").map(artifactVariantLabel))
      .toEqual(["amd64", "arm64", "riscv64"]);
  });
});
