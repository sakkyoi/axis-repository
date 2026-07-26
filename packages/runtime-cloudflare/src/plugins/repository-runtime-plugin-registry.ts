import {
  ValidationError,
  type ArtifactPublisher,
  type Ecosystem,
  type PublishArtifactsInput,
  type PublishResult,
} from "@axis-repository/core";
import type {
  ArtifactRepositoryPlugin,
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
function clonePlugin(descriptor: ArtifactRepositoryPlugin): ArtifactRepositoryPlugin {
  return {
    ...descriptor,
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
  private readonly plugins = new Map<Ecosystem, ArtifactRepositoryPlugin>();

  register(descriptor: RepositoryRuntimePluginDescriptor): void {
    if (this.plugins.has(descriptor.ecosystem)) {
      throw new ValidationError(
        `Artifact publisher is already registered for ecosystem: ${descriptor.ecosystem}`,
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
    this.plugins.set(descriptor.ecosystem, clonePlugin(descriptor));
  }

  list(): PublisherMetadata[] {
    return Array.from(this.plugins.values()).map((descriptor) => {
      const metadata: PublisherMetadata = {
        ecosystem: descriptor.ecosystem,
        name: descriptor.name,
        version: descriptor.version,
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

  getPlugin(ecosystem: Ecosystem): ArtifactRepositoryPlugin | undefined {
    const plugin = this.plugins.get(ecosystem);
    if (!plugin) return undefined;
    return clonePlugin(plugin);
  }

  getPluginByAdminResourceNamespace(namespace: string): ArtifactRepositoryPlugin | undefined {
    const plugin = Array.from(this.plugins.values()).find((descriptor) =>
      descriptor.adminResources?.namespace === namespace,
    );
    if (!plugin) return undefined;
    return clonePlugin(plugin);
  }

  requirePlugin(ecosystem: Ecosystem): ArtifactRepositoryPlugin {
    const plugin = this.getPlugin(ecosystem);
    if (!plugin) {
      throw new ValidationError(
        `Artifact repository plugin is not configured for ecosystem: ${ecosystem}`,
      );
    }
    return plugin;
  }

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const descriptor = this.plugins.get(input.repository.ecosystem);
    if (!descriptor) {
      throw new ValidationError(
        `Artifact publisher is not configured for ecosystem: ${input.repository.ecosystem}`,
      );
    }
    return descriptor.publish.finalize(input);
  }
}
