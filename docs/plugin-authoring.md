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
`plugins/runtime.ts`, and enabled ecosystem metadata is listed in
`plugins/catalog.ts`. The Cloudflare Worker host loads runtime plugins through
`packages/runtime-cloudflare/src/default-plugins.ts`; do not import plugin
runtime implementations from routes, services, or other runtime modules.

Runtime tests may use
`@axis-repository/runtime-cloudflare/plugin-runtime/testing` for host test
helpers.

## Catalog Lifecycle

Every plugin must have one entry in `plugins/catalog.ts`. The catalog is the
shared source for plugin lifecycle and host support metadata:

```ts
{
  manifest: examplePluginManifest,
  enabled: true,
  experimental: true,
  runtime: true,
  adminUi: false,
}
```

`enabled` is the deployment catalog default. `experimental` is metadata exposed
to clients for UI labeling and rollout policy. `runtime` means the ecosystem has
Worker/runtime behavior wired in `plugins/runtime.ts`. `adminUi` means the admin
UI behavior is wired in `plugins/admin-ui.ts`.

The runtime and admin UI registries both filter catalog-disabled plugins at
startup, but repository plugin availability is resolved through the admin policy
surface. `GET /admin/repository-plugins` returns:

- `catalogEnabled`: the bundled catalog default
- `enabledOverride`: the persisted admin override, or `null` to inherit
- `enabled`: the effective result, resolved as `enabledOverride ?? catalogEnabled`
- `experimental`, `runtime`, and `adminUi`: catalog lifecycle metadata

Admins can update the persisted override with:

```http
PATCH /admin/repository-plugins/:ecosystem
content-type: application/json

{ "enabled": false }
```

`enabled` may be `true`, `false`, or `null`. `null` resets the ecosystem back to
the catalog default. The route accepts ecosystems from either the catalog or the
runtime plugin registry.

Effective disabled plugins fail closed before repository creation, repository
updates, publish session creation, publish finalization, repository object
serving, client helper handling, and plugin admin resource handling. The admin UI
uses the same metadata to disable create options and to show whether availability
comes from the catalog default or an admin override.

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
`plugins/admin-ui.ts`, and enabled ecosystem metadata is listed in
`plugins/catalog.ts`. The admin UI host loads UI plugins through
`packages/admin-ui/src/repository-ui-plugins.ts`. Pages and shared UI modules
should ask the registry for plugin behavior instead of importing plugin
implementations directly.

## Adding A Plugin

1. Add `plugins/<ecosystem>/manifest.ts`.
2. Add runtime behavior under `plugins/<ecosystem>/runtime/`.
3. Add admin UI behavior under `plugins/<ecosystem>/admin-ui/` if needed.
4. Add the ecosystem manifest and lifecycle metadata to `plugins/catalog.ts`.
5. Wire runtime behavior in `plugins/runtime.ts`.
6. Wire admin UI behavior in `plugins/admin-ui.ts`.
7. Add focused tests beside the new plugin code.
8. Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The package boundary guard in
`packages/core/src/package-boundaries.test.ts` enforces the import and registry
rules described here.
