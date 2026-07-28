import {
  ValidationError,
  type ArtifactPublisher,
  type PublishArtifactsInput,
  type PublishResult,
  type PublishedObject,
  type RepositoryObjectMetadata,
  type RepositoryObjectStore,
} from "@axis-repository/core";
import { packageObjectKey } from "./layout";
import { readDistributionMetadata } from "./distribution-source";
import { sha256Hex } from "./digest";
import { inValidationErrors } from "./format";
import {
  readPublishedProjectFiles,
  writeSimpleIndexes,
  type PypiIndexWrite,
} from "./index-store";
import type { SimpleProjectFile } from "./simple-index";
import { requireMetadataMatchesFilename } from "../shared/metadata";
import { requireDistributionFilename } from "../shared/names";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";
/** PEP 658 serves core metadata as plain text, the way METADATA is written. */
const METADATA_CONTENT_TYPE = "text/plain; charset=utf-8";

/**
 * Moves a session's uploads into the repository.
 *
 * An upload lands in staging, which is scoped to the session and is not part
 * of what the repository serves. Publishing copies it to the packages tree,
 * under the project the filename names, which is the only place a client can
 * fetch it from.
 */
export class PypiPublisher implements ArtifactPublisher {
  constructor(
    private readonly options: {
      /** Resolves the store for the repository being published to. */
      objectStoreFor: (repositoryName: string) => RepositoryObjectStore;
      now?: () => Date;
    },
  ) {}

  async publish(input: PublishArtifactsInput): Promise<PublishResult> {
    const objectStore = this.options.objectStoreFor(input.repository.name);
    const publishedAt = input.session.publishStartedAt
      ?? input.session.finalizingStartedAt
      ?? (this.options.now ?? (() => new Date()))().toISOString();

    // Each file is read where it lies, so its own record of what it is can be
    // checked against the name it was uploaded under. A wheel called
    // django-5.0-...whl that contains something else would otherwise be
    // offered to everyone who asks pip for Django.
    const copies = await inValidationErrors(() => Promise.all(input.artifacts.map(async ({ artifact, verified }) => {
      const distribution = requireDistributionFilename(artifact.filename);
      const metadata = await readDistributionMetadata({
        objectStore,
        key: verified.objectKey,
        distribution,
      });
      requireMetadataMatchesFilename(metadata, distribution);
      const destinationKey = packageObjectKey(input.repository.name, distribution, artifact.filename);
      return {
        project: distribution.normalizedName,
        sourceKey: verified.objectKey,
        destinationKey,
        contentType: artifact.contentType || DEFAULT_CONTENT_TYPE,
        // Published beside the distribution so a resolver can read its
        // dependencies without downloading it (PEP 658).
        coreMetadata: { key: `${destinationKey}.metadata`, text: metadata.text },
        // The digest the upload was verified against, so the index states what
        // was actually stored rather than hashing the file a second time.
        file: {
          filename: artifact.filename,
          sha256: verified.sha256,
          ...(metadata.requiresPython ? { requiresPython: metadata.requiresPython } : {}),
          coreMetadataSha256: await sha256Hex(new TextEncoder().encode(metadata.text)),
        },
      };
    })));

    // Two files in one session cannot claim the same path: the second copy
    // would silently replace the first and the session would report both as
    // published.
    const destinations = new Set<string>();
    for (const copy of copies) {
      if (destinations.has(copy.destinationKey)) {
        throw new ValidationError(
          `PyPI publish contains the same distribution twice: ${copy.destinationKey.split("/").pop()}`,
        );
      }
      destinations.add(copy.destinationKey);
    }

    const previous = new Map<string, RepositoryObjectMetadata | null>(
      await Promise.all(copies.map(async (copy) => [
        copy.destinationKey,
        await objectStore.headObject(copy.destinationKey),
      ] as const)),
    );

    for (const copy of copies) {
      await objectStore.copyObject(copy.sourceKey, copy.destinationKey, copy.contentType);
      await objectStore.putText(copy.coreMetadata.key, copy.coreMetadata.text, METADATA_CONTENT_TYPE);
    }

    // The index is written after the files it points at, so a client that
    // reads a page always finds what the page describes.
    const indexObjects = await writeSimpleIndexes({
      objectStore,
      repositoryName: input.repository.name,
      projects: await mergedProjects({
        objectStore,
        repositoryName: input.repository.name,
        published: copies,
      }),
    });

    return {
      publishedAt,
      objects: [
        ...copies.flatMap((copy) => [
          withPreviousMetadata(
            { key: copy.destinationKey, contentType: copy.contentType },
            previous.get(copy.destinationKey) ?? null,
          ),
          { key: copy.coreMetadata.key, contentType: METADATA_CONTENT_TYPE },
        ]),
        ...indexObjects,
      ],
    };
  }
}

/**
 * Merges this session's files into what each affected project already lists.
 *
 * Publishing is additive: a project's earlier releases stay on its page, and a
 * file republished under the same name replaces its own entry rather than
 * appearing twice.
 */
async function mergedProjects(input: {
  objectStore: RepositoryObjectStore;
  repositoryName: string;
  published: Array<{ project: string; file: SimpleProjectFile }>;
}): Promise<PypiIndexWrite[]> {
  const byProject = new Map<string, SimpleProjectFile[]>();
  for (const { project, file } of input.published) {
    byProject.set(project, [...(byProject.get(project) ?? []), file]);
  }

  return Promise.all([...byProject].map(async ([project, added]) => {
    const existing = await readPublishedProjectFiles({
      objectStore: input.objectStore,
      repositoryName: input.repositoryName,
      project,
    });
    const files = new Map(existing.map((file) => [file.filename, file] as const));
    for (const file of added) {
      files.set(file.filename, file);
    }
    return { project, files: [...files.values()] };
  }));
}

function withPreviousMetadata(
  object: PublishedObject,
  previous: RepositoryObjectMetadata | null,
): PublishedObject {
  if (!previous) {
    return object;
  }
  return {
    ...object,
    previous: {
      ...(previous.contentType !== undefined ? { contentType: previous.contentType } : {}),
      ...(previous.contentLength !== undefined ? { size: previous.contentLength } : {}),
      ...(previous.etag !== undefined ? { etag: previous.etag } : {}),
    },
  };
}
