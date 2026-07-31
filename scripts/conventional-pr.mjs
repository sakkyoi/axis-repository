const allowedTypes = new Set([
  "feat",
  "fix",
  "docs",
  "chore",
  "ci",
  "build",
  "refactor",
  "test",
  "perf",
  "style",
  "revert",
]);

const typeLabels = {
  feat: "type/feature",
  fix: "type/bug",
  docs: "type/documentation",
  chore: "type/maintenance",
  ci: "type/maintenance",
  build: "type/maintenance",
  refactor: "type/maintenance",
  test: "type/maintenance",
  perf: "type/maintenance",
  style: "type/maintenance",
  revert: "type/maintenance",
};

const releaseLabels = {
  feat: "release/minor",
  fix: "release/patch",
  docs: "release/patch",
  ci: "release/patch",
  perf: "release/patch",
  chore: "release/skip",
  build: "release/skip",
  refactor: "release/skip",
  test: "release/skip",
  style: "release/skip",
  revert: "release/skip",
};

export const managedTypeLabels = [
  "type/feature",
  "type/bug",
  "type/documentation",
  "type/maintenance",
  "type/dependencies",
  "type/security",
];

export const managedReleaseLabels = [
  "release/skip",
  "release/major",
  "release/minor",
  "release/patch",
];

export const managedImpactLabels = ["impact/breaking"];

export function parseConventionalTitle(title) {
  const match = /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9-]*)\))?(?<breaking>!)?: (?<description>.+)$/.exec(
    title.trim(),
  );

  if (!match?.groups) {
    return {
      ok: false,
      error:
        "PR title must follow Conventional Commits: <type>[optional-scope][!]: <description>.",
    };
  }

  const type = match.groups.type;
  if (!allowedTypes.has(type)) {
    return {
      ok: false,
      error: `Unsupported Conventional Commit type '${type}'.`,
    };
  }

  return {
    ok: true,
    type,
    scope: match.groups.scope ?? null,
    breaking: match.groups.breaking === "!",
    description: match.groups.description,
  };
}

export function labelsForConventionalTitle(title) {
  const parsed = parseConventionalTitle(title);
  if (!parsed.ok) {
    return { parsed, labels: [] };
  }

  const dependencyChange =
    (parsed.type === "chore" || parsed.type === "build") &&
    parsed.scope === "deps";
  const labels = [
    dependencyChange ? "type/dependencies" : typeLabels[parsed.type],
  ];

  if (parsed.breaking) {
    labels.push("impact/breaking", "release/major");
  } else if (dependencyChange) {
    labels.push("release/patch");
  } else {
    labels.push(releaseLabels[parsed.type]);
  }

  return { parsed, labels };
}
