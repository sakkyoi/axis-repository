# Plugin Authoring

Axis plugins are repository-format adapters. A plugin owns the format-specific
manifest, runtime behavior, and optional admin UI behavior for one ecosystem.
The Axis packages provide the host contracts; plugin code should not import
package source files directly.

## Directory Shape

Put each plugin under `plugins/<ecosystem>/`:

```text
plugins/<ecosystem>/
  package.json
  plugin.ts
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

Each plugin directory is a private workspace package. Name it
`@axis-repository/plugin-<ecosystem>` and expose only the subpaths that the host
or focused tests need.

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

`manifest.ts` describes the ecosystem, repository configuration fields, public
client helpers, and plugin admin resources. It must export a
`RepositoryPluginManifest`:

```ts
import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";

export const examplePluginManifest = {
  ecosystem: "example",
  displayName: "Example",
  description: "Example repository format.",
  runtimeName: "example-runtime",
  version: "0.1.0",
  capabilities: ["example"],
  repositoryConfig: {
    namespace: "example",
    fields: [],
  },
} satisfies RepositoryPluginManifest;
```

Keep the manifest free of runtime-only or UI-only dependencies. It should be
safe to import from both the Worker runtime and the admin UI.

The manifest is the shared metadata contract. Runtime and admin UI plugins
should derive ecosystem names, versions, capabilities, repository config fields,
client helper descriptors, and admin resource descriptors from it instead of
duplicating literal values. Runtime handlers and UI components can contain
implementation logic, but their public descriptors should stay aligned with the
manifest.

Use `clientHelpers` when an ecosystem exposes public repository setup data, such
as install commands or index URLs. Use `adminResources` when an ecosystem needs
repository-scoped admin-only APIs, such as signing key management. The host owns
the outer route shell; the plugin owns the namespace, action names, methods,
relative paths, response kinds, and handlers.

### `public: true` bypasses repository read authorization

A client helper action marked `public: true` is served **without any
authentication, even for a private repository**. The host checks the flag and
skips `authorizeRepositoryRead` entirely, so this is a trust-boundary decision
delegated to the plugin author with no host-side ceiling.

Only mark an action public when everything it can return is safe to hand to an
anonymous caller, and remember that responding at all confirms the repository
exists and reveals whatever the response embeds. APT marks `key.gpg`, `source`,
and `install` public because a signing **public** key, a codename, and a
component list are the values a client needs before it can authenticate. Never
mark an action public if it reads repository contents, secrets, or anything
derived from a token.

### Plugin capabilities are scoped by the host

Each plugin's secret capability is bound to the namespaces its ecosystem owns —
`apt` and anything under `apt.` — so a plugin cannot read another plugin's
secrets even by guessing an id. The object store passed to artifact index
operations is likewise confined to `repositories/<name>/` for writes, plus the
staging area for reads. Do not try to reach around these; ask for a host API
instead.

## Runtime Plugin

Runtime behavior belongs under `plugins/<ecosystem>/runtime/`. Export a factory
that returns an `ArtifactRepositoryPlugin` from
`@axis-repository/runtime-cloudflare/plugin-runtime`.

Runtime plugins own:

- repository config validation
- publish lifecycle behavior
- publish finalization
- client helper data
- plugin admin resource handlers
- repository path serving rules

The publish lifecycle is grouped under `publish`:

- `validateArtifacts` checks ecosystem-specific upload metadata before a
  publish session can proceed.
- `derivePrincipalScope` optionally derives token scope requirements from a
  repository, such as APT signing key IDs.
- `authorize` checks the principal against ecosystem-specific requirements.
- `finalize` writes repository objects and returns published object metadata.

Client helpers and admin resources combine manifest descriptors with runtime
handlers. The descriptor portion must match the shared manifest; the handler
function belongs only to the runtime plugin.

Runtime plugins are exposed through the plugin package exports. The Cloudflare
Worker host loads bundled runtime capabilities through
`packages/runtime-cloudflare/src/plugins/bundled-runtime-plugins.ts`; do not
import plugin runtime implementations from routes, services, or other runtime
modules.

Runtime tests may use
`@axis-repository/runtime-cloudflare/plugin-runtime/testing` for host test
helpers. New runtime plugins should add a parity test:

```ts
import { assertRuntimePluginManifestParity } from "@axis-repository/runtime-cloudflare/plugin-runtime/testing";

assertRuntimePluginManifestParity({
  manifest: examplePluginManifest,
  plugin: createExamplePlugin(),
});
```

The helper verifies the runtime plugin ecosystem, name, version, capabilities,
client helper descriptors, and admin resource descriptors against the manifest.
It intentionally ignores handler functions.

## Bundle And Catalog Lifecycle

Every plugin must export one `RepositoryPluginBundle` from
`@axis-repository/plugin-<ecosystem>` (`plugins/<ecosystem>/plugin.ts`). The
bundle is the plugin's self-description:

```ts
export const exampleRepositoryPluginBundle = {
  manifest: examplePluginManifest,
  catalog: {
    enabled: true,
    experimental: true,
  },
  runtime: true,
  adminUi: true,
} satisfies RepositoryPluginBundle;
```

Add explicit package exports in `plugins/<ecosystem>/package.json`, for example:

```json
{
  "name": "@axis-repository/plugin-example",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./plugin.ts",
    "./manifest": "./manifest.ts",
    "./runtime": "./runtime/runtime.ts",
    "./admin-ui": "./admin-ui/index.ts"
  }
}
```

Add the bundle package to `plugins/bundled.ts`. This is the only static bundled
plugin list. TypeScript and Worker builds should not discover plugins by
scanning the filesystem.

`catalog.enabled` is the deployment catalog default. `catalog.experimental` is
metadata exposed to clients for UI labeling and rollout policy. `runtime` means
the ecosystem provides Worker/runtime behavior. `adminUi` means the ecosystem
provides admin UI behavior.

`plugins/catalog.ts` projects policy metadata from bundled plugin descriptors.
It should not hand-maintain a second ecosystem list.

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

The admin UI plugin is a renderer and workflow adapter. It should not own
repository-format policy that belongs in the manifest or runtime plugin. Create
plugins must use the manifest repository config. Detail, publish, field
renderer, and token-scope extensions must declare behavior for the same
ecosystem as the manifest.

Admin UI plugins are exposed through the plugin package exports. The admin UI
host loads bundled UI capabilities through
`packages/admin-ui/src/repositories/plugins/repository-ui-plugins.ts`. Pages and
shared UI modules should ask the registry for plugin behavior instead of
importing plugin implementations directly.

The UI registry exposes `assertRepositoryUiPluginContracts()` for registry-level
tests. It checks that UI plugin ecosystems are unique, create/detail/publish
extensions match the manifest ecosystem, create plugins use the manifest
repository config, detail section IDs are unique, and custom field renderers
refer to field kinds declared by the manifest.

## Adding A Plugin

1. Add `plugins/<ecosystem>/manifest.ts`.
2. Add `plugins/<ecosystem>/package.json` with explicit private package exports.
3. Add runtime behavior under `plugins/<ecosystem>/runtime/`.
4. Add admin UI behavior under `plugins/<ecosystem>/admin-ui/` if needed.
5. Add `plugins/<ecosystem>/plugin.ts` with a `RepositoryPluginBundle`.
6. Add the bundle package to `plugins/bundled.ts`.
7. Let package host loaders register runtime and admin UI capabilities from package exports.
8. Add focused tests beside the new plugin code.
9. Run:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The package boundary guard in
`packages/core/src/package-boundaries.test.ts` enforces the import and registry
rules described here.
