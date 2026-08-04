import {
  ValidationError,
  type ArtifactPublisher,
  type Ecosystem,
  type PublishArtifactsInput,
  type PublishResult,
  type RepositoryKind,
} from "@axis-repository/core";
import type {
  HostedRepositoryPlugin,
  PublisherMetadata,
  RepositoryRuntimePluginDescriptor,
} from "./repository-plugin-contract";
import { publicClientHelperAction } from "./repository-plugin-client-helpers";

/**
 * Copies the metadata a caller could otherwise mutate in place.
 *
 * The lifecycle objects (publish, artifacts, create) are shared by reference:
 * they hold the plugin's behaviour, and re-wrapping them would not stop a
 * caller reassigning a hook anyway. Only host code holds these descriptors, so
 * the guarantee is "metadata is a copy", not "the descriptor is frozen".
 */
function clonePlugin(descriptor: HostedRepositoryPlugin): HostedRepositoryPlugin {
  return {
    ...descriptor,
    repositoryKinds: [...(descriptor.repositoryKinds ?? ["hosted"])],
    capabilities: [...descriptor.capabilities],
    ...(descriptor.clientHelpers
      ? {
          clientHelpers: {
            ...descriptor.clientHelpers,
            actions: descriptor.clientHelpers.actions.map((action) => ({ ...action })),
          },
        }
      : {}),
    ...(descriptor.adminResources
      ? {
          adminResources: {
            ...descriptor.adminResources,
            routes: descriptor.adminResources.routes.map((route) => ({
              ...route,
              path: [...route.path],
            })),
          },
        }
      : {}),
  };
}

function pluginKey(input: { ecosystem: Ecosystem; kind: RepositoryKind }): string {
  return `${input.kind}:${input.ecosystem}`;
}

const ECOSYSTEM_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * An ecosystem id decides which secret namespaces a plugin owns
 * (`<ecosystem>` and `<ecosystem>.*`), so it has to be a single flat token.
 * Allowing a dot would let a plugin registered as `apt` own everything
 * belonging to one registered as `apt.extra`.
 */
export function assertRegistrableEcosystem(ecosystem: string): void {
  if (!ECOSYSTEM_PATTERN.test(ecosystem)) {
    throw new ValidationError(
      `Repository plugin ecosystem must be lowercase alphanumeric with hyphens: ${ecosystem}`,
    );
  }
}

function validateAdminResourceRoutes(descriptor: RepositoryRuntimePluginDescriptor): void {
  const seenRouteNames = new Set<string>();
  for (const route of descriptor.adminResources?.routes ?? []) {
    if (seenRouteNames.has(route.name)) {
      throw new ValidationError(
        `Duplicate admin resource route name for ecosystem ${descriptor.ecosystem}: ${route.name}`,
      );
    }
    seenRouteNames.add(route.name);
  }
}

export class RepositoryRuntimePluginRegistry implements ArtifactPublisher {
  private readonly plugins = new Map<string, HostedRepositoryPlugin>();

  register(descriptor: RepositoryRuntimePluginDescriptor): void {
    assertRegistrableEcosystem(descriptor.ecosystem);
    if (!descriptor.kind) {
      throw new ValidationError(`Repository runtime plugin kind is required for ecosystem: ${descriptor.ecosystem}`);
    }
    const key = pluginKey(descriptor);
    if (this.plugins.has(key)) {
      throw new ValidationError(
        `Artifact publisher is already registered for repository kind and ecosystem: ${descriptor.kind} ${descriptor.ecosystem}`,
      );
    }
    if (
      descriptor.adminResources &&
      Array.from(this.plugins.values()).some((plugin) =>
        plugin.adminResources?.namespace === descriptor.adminResources?.namespace,
      )
    ) {
      throw new ValidationError(
        `Admin resource namespace is already registered: ${descriptor.adminResources.namespace}`,
      );
    }
    validateAdminResourceRoutes(descriptor);
    this.plugins.set(key, clonePlugin(descriptor));
  }

  list(): PublisherMetadata[] {
    return Array.from(this.plugins.values()).map((descriptor) => {
      const metadata: PublisherMetadata = {
        ecosystem: descriptor.ecosystem,
        name: descriptor.name,
        version: descriptor.version,
        repositoryKinds: [...(descriptor.repositoryKinds ?? ["hosted"])],
        capabilities: [...descriptor.capabilities],
      };
      if (descriptor.clientHelpers) {
        metadata.clientHelpers = {
          namespace: descriptor.clientHelpers.namespace,
          actions: descriptor.clientHelpers.actions.map(publicClientHelperAction),
        };
      }
      return metadata;
    });
  }

  getPlugin(ecosystem: Ecosystem): HostedRepositoryPlugin | undefined {
    const plugin = this.plugins.get(pluginKey({ ecosystem, kind: "hosted" }));
    if (!plugin) return undefined;
    return clonePlugin(plugin);
  }

  getPluginForRepository(repository: { ecosystem: Ecosystem; kind: RepositoryKind }): HostedRepositoryPlugin | undefined {
    const plugin = this.plugins.get(pluginKey(repository));
    if (!plugin) return undefined;
    return clonePlugin(plugin);
  }

  getPluginByAdminResourceNamespace(namespace: string): HostedRepositoryPlugin | undefined {
    const plugin = Array.from(this.plugins.values()).find((descriptor) =>
      descriptor.adminResources?.namespace === namespace,
    );
    if (!plugin) return undefined;
    return clonePlugin(plugin);
  }

  requirePlugin(ecosystem: Ecosystem): HostedRepositoryPlugin {
    const plugin = this.plugins.get(pluginKey({ ecosystem, kind: "hosted" }));
    if (!plugin) {
      throw new ValidationError(
        `Artifact repository plugin is not configured for ecosystem: ${ecosystem}`,
      );
    }
    return clonePlugin(plugin);
  }

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const descriptor = this.plugins.get(pluginKey(input.repository));
    if (!descriptor) {
      throw new ValidationError(
        `Artifact publisher is not configured for repository kind and ecosystem: ${input.repository.kind} ${input.repository.ecosystem}`,
      );
    }
    return descriptor.publish.finalize(input);
  }
}
