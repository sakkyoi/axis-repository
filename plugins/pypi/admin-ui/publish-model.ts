import { sha256Hex, type PublishArtifact } from "@axis-repository/admin-ui/plugin-ui";
import { streamFromBytes, zipSourceFromBytes, type ByteStream } from "@axis-repository/core/archives";
import {
  readSdistMetadata,
  readWheelMetadata,
  requireMetadataMatchesFilename,
} from "../shared/metadata";
import { parseDistributionFilename, type PypiDistributionKind } from "../shared/names";

/**
 * What the browser can tell about a distribution before uploading it.
 *
 * The same readers the worker uses run here, so a file whose contents do not
 * match its name is reported while the operator is still looking at it, rather
 * than as a failed publish afterwards.
 */
export interface PypiPublishDistributionMetadata {
  kind: PypiDistributionKind;
  project: string;
  version: string;
  requiresPython?: string;
}

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export function pypiIsAcceptedFile(file: { name: string }): boolean {
  return parseDistributionFilename(file.name) !== undefined;
}

export function pypiCanPublishArtifact(input: {
  file: File | undefined;
  metadata: PypiPublishDistributionMetadata | undefined;
  error: string;
  isPublishing: boolean;
}): boolean {
  return Boolean(input.file && input.metadata && !input.error && !input.isPublishing);
}

export async function readPypiPublishMetadata(file: File): Promise<PypiPublishDistributionMetadata> {
  const distribution = parseDistributionFilename(file.name);
  if (!distribution) {
    throw new Error(`${file.name} is not a wheel or source distribution`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = distribution.kind === "wheel"
    ? await readWheelMetadata(zipSourceFromBytes(bytes))
    : await readSdistMetadata(streamFromBytes(bytes) as ByteStream);
  // The same check the worker makes, so a mismatch is visible before the
  // upload rather than after it.
  requireMetadataMatchesFilename(metadata, distribution);

  return {
    kind: distribution.kind,
    project: distribution.normalizedName,
    version: metadata.version,
    ...(metadata.requiresPython ? { requiresPython: metadata.requiresPython } : {}),
  };
}

export async function buildPypiPublishArtifact(file: File): Promise<PublishArtifact> {
  return {
    filename: file.name,
    size: file.size,
    sha256: await sha256Hex(file),
    contentType: file.type || DEFAULT_CONTENT_TYPE,
    metadata: {},
  };
}
