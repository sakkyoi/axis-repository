# Plugin Authoring

Axis plugins are repository-format adapters. A plugin owns the format-specific
manifest, runtime behavior, and optional admin UI behavior for one ecosystem.
The Axis packages provide the host contracts; plugin code should not import
package source files directly.

## Directory Shape

Put each plugin under `plugins/<ecosystem>/`:

```text
plugins/<ecosystem>/
  manifest.ts
  runtime/
    runtime.ts
    *.test.ts
  admin-ui/
    index.ts
    create.ts
    detail.tsx
    publish.tsx
    *.test.ts
```

Only add files that the ecosystem needs. For example, a plugin without
format-specific publish UI does not need a `publish.tsx`.

## Public Entrypoints

Plugin code may import Axis contracts only from public package entrypoints:

```ts
import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import type { ArtifactRepositoryPlugin } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import type { RepositoryUiPlugin } from "@axis-repository/admin-ui/plugin-ui";
```

Allowed entrypoints for plugin implementation code are:

```text
@axis-repository/core
@axis-repository/core/plugin-manifests
@axis-repository/runtime-cloudflare/plugin-runtime
@axis-repository/runtime-cloudflare/plugin-runtime/testing
@axis-repository/admin-ui/plugin-ui
```

Do not import from `packages/*/src`. If a plugin needs a host API that is not
exported, add it to the appropriate public entrypoint first.

`@axis-repository/publish-client` and `@axis-repository/publish-client/cli` are
public package entrypoints for external publishers and automation. They are not
plugin implementation dependencies.

## Manifest

`manifest.ts` describes the ecosystem and repository configuration fields. It
must export a `RepositoryPluginManifest`:

```ts
import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";

export const examplePluginManifest = {
  ecosystem: "example",
  displayName: "Example",
  description: "Example repository format.",
  repositoryConfigFields: [],
} satisfies RepositoryPluginManifest;
```

Keep the manifest free of runtime-only or UI-only dependencies. It should be
safe to import from both the Worker runtime and the admin UI.

## Runtime Plugin

Runtime behavior belongs under `plugins/<ecosystem>/runtime/`. Export a factory
that returns an `ArtifactRepositoryPlugin` from
`@axis-repository/runtime-cloudflare/plugin-runtime`.

Runtime plugins own:

- repository config validation
- publish authorization and artifact validation
- publish finalization
- client helper data
- repository path serving rules

Runtime plugins are registered only in
`packages/runtime-cloudflare/src/default-plugins.ts`. Do not import plugin
runtime implementations from routes, services, or other runtime modules.

Runtime tests may use
`@axis-repository/runtime-cloudflare/plugin-runtime/testing` for host test
helpers.

## Admin UI Plugin

Admin UI behavior belongs under `plugins/<ecosystem>/admin-ui/`. Export a
`RepositoryUiPlugin` from `index.ts` using
`@axis-repository/admin-ui/plugin-ui`.

Admin UI plugins may provide:

- repository creation steps
- custom field renderers
- repository detail sections
- publish UI
- publish token scope UI
- server error mapping for create flows

Admin UI plugins are registered only in
`packages/admin-ui/src/repository-ui-plugins.ts`. Pages and shared UI modules
should ask the registry for plugin behavior instead of importing plugin
implementations directly.

## Adding A Plugin

1. Add `plugins/<ecosystem>/manifest.ts`.
2. Add runtime behavior under `plugins/<ecosystem>/runtime/`.
3. Add admin UI behavior under `plugins/<ecosystem>/admin-ui/` if needed.
4. Register runtime behavior in `packages/runtime-cloudflare/src/default-plugins.ts`.
5. Register admin UI behavior in `packages/admin-ui/src/repository-ui-plugins.ts`.
6. Add focused tests beside the new plugin code.
7. Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The package boundary guard in
`packages/core/src/package-boundaries.test.ts` enforces the import and registry
rules described here.
