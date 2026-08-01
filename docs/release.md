# Release Process

Axis Repository uses manually approved SemVer releases with Release Drafter for
draft release notes. The project is still in active development, so every
release before `v1.0.0` is a deployable preview rather than a production-ready
artifact source.

## Branches

- `main` is the stable development branch. It should stay releasable enough for
  the next preview release, and pull requests must pass CI before merging.
- `feature/*` branches carry normal feature, fix, documentation, and
  maintenance work.
- `release/vX.Y.Z` branches are created only when preparing a release. They are
  for final release notes, documentation updates, version metadata, migration
  notes, and last-minute release fixes.

The project does not use a `develop` branch.

## Versioning

Final release tags use `vMAJOR.MINOR.PATCH`. Release candidate tags use
`vMAJOR.MINOR.PATCH-rc.N`, where `N` starts at `1` and increases for each
candidate of the same final version.

Before `v1.0.0`, Axis uses SemVer-shaped versions with preview semantics:

- `PATCH` covers fixes, documentation, CI, dependency updates, and small
  internal maintenance changes.
- `MINOR` covers new capabilities, user-visible workflow changes, API changes,
  deployment setting changes, data model changes, and plugin contract changes.
- Breaking changes may ship in a `MINOR` release before `v1.0.0`, but the
  release notes must call them out under Breaking Changes.

After `v1.0.0`, Axis should follow strict SemVer.

## Release Candidates

Release candidates use the same `release/vX.Y.Z` branch as the final release.
The branch can publish any number of candidate tags before the final tag:

1. Create `release/vX.Y.Z` from `main`.
2. Prepare release notes, documentation, and migration notes on that branch.
3. Publish `vX.Y.Z-rc.1` as a GitHub prerelease.
4. If more fixes are needed, commit them to the same release branch and publish
   `vX.Y.Z-rc.2`, `vX.Y.Z-rc.3`, and so on.
5. When the candidate is accepted, publish the final `vX.Y.Z` release from the
   accepted commit and mark only the final release as non-prerelease.

Both `vX.Y.Z-rc.N` and `vX.Y.Z` tags run `Release Check`. Release Drafter keeps
draft releases marked as prerelease by default; maintainers manually clear that
flag only for the final release.

## Labels

Labels are grouped by purpose. Pull requests should carry at least one `type/*`
label and usually one `area/*` label. Add `impact/*` labels when a change has a
deployment, storage, authentication, security, or migration consequence.

Pull request titles must follow Conventional Commits:

```text
<type>[optional-scope][!]: <description>
```

Examples:

```text
feat(admin-ui): add repository browser
fix(plugin-apt): rebuild index after object deletion
ci(release): draft stable and rc releases separately
feat(core)!: change plugin contract
```

The scope is optional. The allowed types are `feat`, `fix`, `docs`, `chore`,
`ci`, `build`, `refactor`, `test`, `perf`, `style`, and `revert`.

Automation derives initial labels from the Conventional Commit title with
Release Drafter autolabeler:

- `feat` becomes `type/feature` and `release/minor`.
- `fix` becomes `type/bug` and `release/patch`.
- `docs` becomes `type/documentation` and `release/patch`.
- `ci` becomes `type/maintenance` and `release/patch`.
- `chore(deps)` and `build(deps)` become `type/dependencies` and
  `release/patch`.
- Other maintenance types become `type/maintenance` and `release/skip`.
- `!` marks a breaking change with `impact/breaking` and `release/major`.

Maintainers must review the generated `release/*` and `impact/*` labels before
merge. Use `release/skip` when the change should not appear in release notes.
When a PR already has a `release/*` label, automation treats that as the
maintainer decision and does not replace it.

### Type

- `type/feature` - new user-visible capability.
- `type/bug` - unexpected behavior or regression.
- `type/documentation` - documentation-only change.
- `type/maintenance` - internal cleanup, refactoring, tooling, or CI.
- `type/dependencies` - dependency update.
- `type/security` - security fix or security hardening.

### Area

- `area/runtime-cloudflare`
- `area/admin-ui`
- `area/core`
- `area/publish-client`
- `area/plugin-apt`
- `area/plugin-pypi`
- `area/plugins`
- `area/docs`
- `area/ci`
- `area/release`

### Impact

- `impact/breaking` - behavior, API, data, or deployment compatibility changes.
- `impact/migration` - upgrade requires operator action.
- `impact/security` - security-sensitive behavior changed.
- `impact/storage` - repository object layout or storage behavior changed.
- `impact/auth` - authentication, sessions, or publish tokens changed.
- `impact/deployment` - deployment variables, bindings, or runtime assumptions changed.

### Release

- `release/skip` - exclude the PR from the draft release notes.
- `release/major` - force the resolved next version to a major bump.
- `release/minor` - force the resolved next version to a minor bump.
- `release/patch` - force the resolved next version to a patch bump.

## Drafting

Release Drafter updates the draft release whenever changes land on `main`.
Release notes are grouped in this order:

1. Breaking Changes
2. Security
3. Features
4. Fixes
5. Documentation
6. Dependencies
7. Maintenance
8. Uncategorized

The draft is not authoritative until a maintainer reviews and publishes it.
Maintainers may edit headings, wording, migration notes, and the final version
number before publishing.

## Continuous Integration

Pull requests and pushes to `main` run several focused workflows. Branch
protection can require the core CI jobs while still showing heavier quality
checks and release metadata checks separately.

### CI

The `CI` workflow is the fast release-readiness gate for normal code changes.

- `lockfile` installs with `pnpm install --frozen-lockfile`, making lockfile
  drift visible as its own required check.
- `lint` runs ESLint.
- `typecheck` runs the TypeScript project checks.
- `test` runs the unit and component tests.
- `build` runs the full monorepo build.
- `package-boundaries` runs the package boundary contract check as an explicit
  gate.

### Quality

The `Quality` workflow holds checks that are important but heavier or more
specialized than the fast CI loop.

- `generated-files` rebuilds the embedded admin UI assets and fails if the
  committed generated worker asset map is stale.
- `cloudflare-package` builds the Worker and runs `wrangler deploy --dry-run`
  without deploying anything.
- `coverage` runs the test suite with coverage enabled. It is a visibility gate
  first; coverage thresholds can be added when the project has a stable baseline.
- `dependency-audit` runs a high-and-above dependency audit with an explicit
  allowlist in `docs/security/audit-allowlist.json`. Known advisories need a
  package, reason, and review date; new high or critical advisories fail CI.

### Workflow and PR Metadata

- `Workflow Lint` checks GitHub Actions workflow syntax and common mistakes.
- `PR Governance` checks the PR title, applies path and Conventional Commit
  labels, preserves existing `release/*` decisions, and requires each pull
  request to carry one `type/*` label plus one `release/*` label because
  Release Drafter uses labels to build release notes.
- `PR Commits` checks pull request commit messages with Commitlint.

### Dependency Updates

Dependabot opens weekly grouped pull requests for pnpm dependencies and GitHub
Actions. Dependency pull requests should keep the `type/dependencies` label so
Release Drafter places them in the Dependencies section.

Grouped updates are intentionally conservative:

- GitHub Actions update together.
- Cloudflare runtime tooling updates together.
- development tooling such as ESLint, TypeScript, Vite, Vitest, and tsup updates
  together.
- admin UI dependencies such as React, Radix UI, TanStack Query, and routing
  dependencies update together.

Security updates are still expected to pass the same CI and audit gates as
normal dependency updates. Major dependency updates require human review before
merge, because they can require code migrations even when Dependabot can update
the lockfile.

The local equivalent is:

```bash
pnpm verify
```

`pnpm verify` intentionally stops at a Cloudflare dry run. Deployment smoke
tests against a real Worker are not part of the maintained project tooling
yet, because they need deployment credentials and a real storage backend.

Release branches and version tags, including `vX.Y.Z-rc.N` candidate tags, run
`Release Check`, which executes `pnpm verify` and validates that the release
documentation and workflow entry points are still present. Weekly scheduled
checks rerun coverage and dependency audit, and report outdated dependencies
without failing the workflow.

## Release Checklist

1. Create `release/vX.Y.Z` from `main`.
2. Confirm the expected version number and release scope.
3. Ensure CI is green.
4. Run `pnpm verify` locally or confirm an equivalent CI run.
5. Review deployment, migration, and security notes.
6. Publish one or more release candidates as `vX.Y.Z-rc.N` when validation
   needs an installable prerelease.
7. Publish the final GitHub Release with tag `vX.Y.Z`.
8. Merge release branch changes back into `main` if the branch contains final
   documentation or metadata changes.

## Package Publishing

The first release process does not publish npm packages. Axis is currently
released as a deployable repository and Cloudflare Worker template. Package
publishing can be added later when the publish client or plugin interfaces are
ready to be treated as external artifacts.
