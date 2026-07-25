import {
  ValidationError,
  type ArtifactPublisher,
  type Repository,
  type RepositoryArtifactRecord,
  type RepositoryObject,
  type RepositoryObjectListItem,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import { aptPluginManifest } from "../manifest";
import type {
  ArtifactRepositoryPlugin,
  DescribePublishedArtifactsInput,
  RebuildRepositoryArtifactIndexInput,
  RepositorySigningKeyCapability,
  ValidateRepositoryConfigInput,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createPrefixServingPredicate } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { createAptAdminResources } from "./admin-resources";
import { createAptClientHelpers } from "./client-helpers";
import { parseAptRepositoryConfig, validateAptPublishArtifacts } from "./metadata";
import { readDebControlMetadata } from "./deb-control";

export { AptSigningKeyResource } from "./signing-keys";

function repositoryForConfig(input: ValidateRepositoryConfigInput): Repository {
  return {
    id: "repo_validation",
    name: "repo-validation",
    ecosystem: input.ecosystem,
    visibility: "private",
    config: input.config,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}

export function createAptPlugin(input: {
  publisher: ArtifactPublisher;
  signingKeys: RepositorySigningKeyCapability;
}): ArtifactRepositoryPlugin {
  return {
    ecosystem: "apt",
    name: aptPluginManifest.runtimeName,
    version: aptPluginManifest.version,
    capabilities: [...aptPluginManifest.capabilities],
    canServeRepositoryPath: createPrefixServingPredicate(["dists", "pool"]),
    validateRepositoryConfig: (configInput) => {
      parseAptRepositoryConfig(repositoryForConfig(configInput));
    },
    publish: {
      validateArtifacts: validateAptPublishArtifacts,
      derivePrincipalScope: (repository) => {
        const config = parseAptRepositoryConfig(repository);
        return {
          signingKeyIds: [config.signingKeyId],
        };
      },
      authorize: ({ repository, principal }) => {
        const config = parseAptRepositoryConfig(repository);
        if (!principal.signingKeyIds.includes(config.signingKeyId)) {
          throw new ValidationError("Publish token is not scoped to the repository signing key");
        }
      },
      finalize: (publishInput) => input.publisher.publish(publishInput),
      describeArtifacts: describeAptArtifacts,
    },
    artifacts: {
      rebuildIndex: rebuildAptArtifactIndex,
    },
    clientHelpers: createAptClientHelpers({ signingKeys: input.signingKeys }),
    adminResources: createAptAdminResources({ signingKeys: input.signingKeys }),
  };
}

async function rebuildAptArtifactIndex(input: RebuildRepositoryArtifactIndexInput): Promise<RepositoryArtifactRecord[]> {
  parseAptRepositoryConfig(input.repository);
  const repositoryPrefix = `repositories/${input.repository.name}/`;
  const poolPrefix = `${repositoryPrefix}pool/`;
  const objects = await listAllObjects(input.objectStore, poolPrefix);
  const timestamp = input.now.toISOString();
  const artifacts: RepositoryArtifactRecord[] = [];

  for (const object of objects.filter((candidate) => candidate.key.endsWith(".deb"))) {
    const storedObject = await input.objectStore.getObject(object.key);
    if (!storedObject) continue;

    const bytes = await objectBytes(storedObject);
    const control = await readDebControlMetadata(bytes);
    const packageName = requiredControlString(control, "package");
    const version = requiredControlString(control, "version");
    const architecture = requiredControlString(control, "architecture");
    const description = requiredControlString(control, "description");
    const maintainer = requiredControlString(control, "maintainer");
    const repositoryRelativePath = object.key.slice(repositoryPrefix.length);
    const pathSegments = repositoryRelativePath.split("/");
    const component = pathSegments[1] || "main";
    const metadata = {
      package: packageName,
      version,
      architecture,
      component,
      description,
      maintainer,
      section: control.section,
      priority: control.priority,
      homepage: control.homepage,
      depends: control.depends,
      recommends: control.recommends,
      suggests: control.suggests,
      conflicts: control.conflicts,
      replaces: control.replaces,
      provides: control.provides,
    };
    const identityParts = ["apt", component, packageName, version, architecture];
    artifacts.push({
      id: `artifact_${input.repository.name}_${identityParts.join("_")}`,
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      identity: identityParts.join(":"),
      name: packageName,
      version,
      summary: `${packageName} ${version} ${architecture}`,
      primaryObjectKey: object.key,
      objectKeys: [object.key],
      metadata,
      publishedAt: timestamp,
      updatedAt: timestamp,
    });
  }

  return artifacts;
}

function describeAptArtifacts(input: DescribePublishedArtifactsInput): RepositoryArtifactRecord[] {
  return input.session.artifacts.map((artifact) => {
    const packageName = metadataString(artifact.metadata, "package") ?? artifact.filename;
    const version = metadataString(artifact.metadata, "version");
    const architecture = metadataString(artifact.metadata, "architecture");
    const component = metadataString(artifact.metadata, "component") ?? "main";
    const primaryObjectKey = input.result.objects.find((object) =>
      object.key.includes("/pool/") && object.key.endsWith(`/${artifact.filename}`),
    )?.key;
    const identityParts = ["apt", component, packageName, version, architecture].filter((part): part is string =>
      Boolean(part),
    );
    const summaryParts = [packageName, version, architecture].filter((part): part is string => Boolean(part));
    return {
      id: `artifact_${input.repository.name}_${identityParts.join("_")}`,
      repositoryName: input.repository.name,
      ecosystem: input.repository.ecosystem,
      identity: identityParts.join(":"),
      name: packageName,
      ...(version ? { version } : {}),
      summary: summaryParts.join(" "),
      ...(primaryObjectKey ? { primaryObjectKey } : {}),
      objectKeys: primaryObjectKey ? [primaryObjectKey] : [],
      metadata: { ...artifact.metadata },
      publishedAt: input.result.publishedAt,
      updatedAt: input.result.publishedAt,
      publishSessionId: input.session.id,
    };
  });
}

function metadataString(metadata: Record<string, unknown>, field: string): string | undefined {
  const value = metadata[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiredControlString(metadata: Record<string, string>, field: string): string {
  const value = metadata[field];
  if (!value) {
    throw new ValidationError(`APT artifact control field is required: ${field}`);
  }
  return value;
}

async function listAllObjects(objectStore: RepositoryObjectStore, prefix: string): Promise<RepositoryObjectListItem[]> {
  const objects: RepositoryObjectListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await objectStore.listObjects({
      prefix,
      ...(cursor ? { cursor } : {}),
    });
    objects.push(...page.objects);
    cursor = page.cursor;
  } while (cursor);
  return objects;
}

async function objectBytes(object: RepositoryObject): Promise<Uint8Array> {
  if (object.body instanceof Uint8Array) {
    return object.body;
  }
  if (typeof object.body === "string") {
    return new TextEncoder().encode(object.body);
  }
  const chunks: Uint8Array[] = [];
  const reader = object.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(next.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
