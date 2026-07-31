import type { RepositoryArtifact } from "../../api/schemas";

/**
 * The artifacts that are one thing, gathered.
 *
 * A row per version made the list as long as the repository's publishing
 * history rather than as long as what it holds, and repeated the name down the
 * column the eye scans while the value that told them apart sat in a narrow
 * one to the side. Worse, the list is ordered by when things were published,
 * so a package's own versions were separated by everything published between
 * them.
 *
 * What counts as one thing is the ecosystem's to say, and it says so with the
 * family it puts on each artifact. An artifact from a plugin that says nothing
 * stands on its own.
 *
 * A version is not the bottom of this: apt builds a package for several
 * architectures and stores each separately, so one version can be several
 * artifacts. What tells those apart is read from the summary the plugin wrote
 * rather than from a field of our own -- the plugin already had to name the
 * thing, and the name is what it chose.
 */
export interface ArtifactGroup {
  key: string;
  name: string;
  /** Every artifact in the family, highest version first. */
  artifacts: RepositoryArtifact[];
  /** Distinct versions, highest first. */
  versions: string[];
  latest: RepositoryArtifact;
}

/**
 * Orders versions for display, highest first.
 *
 * Numerically, so 0.10 outranks 0.9. This is not Debian's ordering: an epoch
 * (`1:`) and a tilde (`1.0~rc1`, which precedes `1.0`) both mean something
 * here that this does not implement, so a repository publishing pre-releases
 * will see them ranked above the release they precede. Getting that right
 * means asking the plugin, which is the only thing that knows its own rules;
 * this is a display order, and nothing depends on it.
 */
const versionOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * What separates one artifact from another of the same name and version.
 *
 * apt's architecture, in practice. Read from the summary rather than from the
 * metadata, because the summary is what the plugin chose to call it and the
 * metadata keys are its own business.
 */
export function artifactVariantLabel(artifact: RepositoryArtifact): string | undefined {
  const words = artifact.summary
    .split(" ")
    .filter((word) => word && word !== artifact.name && word !== artifact.version);
  return words.length > 0 ? words.join(" ") : undefined;
}

export function groupArtifactsByFamily(artifacts: RepositoryArtifact[]): ArtifactGroup[] {
  const families = new Map<string, RepositoryArtifact[]>();

  for (const artifact of artifacts) {
    // Falling back to the id keeps an ungrouped artifact in a group of one, so
    // there is one shape to render rather than two.
    const key = artifact.family ?? artifact.id;
    const existing = families.get(key);
    if (existing) {
      existing.push(artifact);
      continue;
    }
    families.set(key, [artifact]);
  }

  return [...families.entries()].map(([key, members]) => {
    // Not the order they arrived in: a rebuild stamps every artifact with one
    // timestamp, after which the list falls back to sorting by id and 0.1.0
    // would be the newest of anything.
    const ordered = [...members].sort((left, right) =>
      versionOrder.compare(right.version ?? "", left.version ?? ""));
    const versions: string[] = [];
    for (const artifact of ordered) {
      const version = artifact.version ?? "";
      if (!versions.includes(version)) {
        versions.push(version);
      }
    }
    return {
      key,
      name: ordered[0]?.name ?? "",
      artifacts: ordered,
      versions,
      latest: ordered[0]!,
    };
  });
}

/**
 * The artifacts of one version, which is several where they are built per
 * architecture, in an order of their own.
 *
 * By name, because the order they are stored in is the order of the versions
 * and says nothing about these: two builds of one version are equal there, and
 * an order left to chance moves the chips around between visits.
 */
export function artifactsForVersion(group: ArtifactGroup, version: string): RepositoryArtifact[] {
  return group.artifacts
    .filter((artifact) => (artifact.version ?? "") === version)
    .sort((left, right) => (artifactVariantLabel(left) ?? "").localeCompare(artifactVariantLabel(right) ?? ""));
}

/** Only worth saying when there is more than one to count. */
export function artifactVersionCountLabel(group: ArtifactGroup): string | undefined {
  return group.versions.length < 2 ? undefined : `${group.versions.length} versions`;
}
