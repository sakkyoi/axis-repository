import { ValidationError, type PublishArtifactRequest } from "@axis-repository/core";
import type {
  ParsedProtocolUpload,
  ProtocolUploadSink,
  RepositoryUploadProtocol,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { streamMultipart } from "@web3-storage/multipart-parser";
import { requireDistributionFilename } from "../shared/names";
import { inValidationErrors } from "./format";

/**
 * The upload API `twine` speaks.
 *
 * PyPI's legacy endpoint takes one `multipart/form-data` POST carrying the
 * distribution and a handful of fields describing it. Everything about the
 * publish that follows — validation, the write lock, index generation — is the
 * same as for any other client; only the shape of the request differs.
 *
 * The distribution is passed straight through to storage rather than read into
 * memory. A worker has 128 MB of heap and a wheel can be far larger than that,
 * so anything that materialized the part would put a ceiling on package size
 * that nothing else here imposes.
 */

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Fields are small by nature; a form claiming otherwise is malformed. */
const MAX_FIELD_BYTES = 64 * 1024;

export function createPypiUploadProtocol(): RepositoryUploadProtocol {
  return {
    path: "legacy",

    parseUpload: (
      request: Request,
      sink: ProtocolUploadSink,
    ): Promise<ParsedProtocolUpload[]> => inValidationErrors(async () => {
      const boundary = multipartBoundary(request);
      if (!boundary || !request.body) {
        throw new ValidationError("PyPI upload is not a multipart form");
      }

      const fields = new Map<string, string>();
      let upload: ParsedProtocolUpload | undefined;

      for await (const part of streamMultipart(request.body, boundary)) {
        if (part.filename === undefined) {
          fields.set(part.name ?? "", await readField(part.data));
          continue;
        }
        if (upload) {
          throw new ValidationError("PyPI upload carries more than one distribution");
        }

        const filename = part.filename;
        requireDistributionFilename(filename);
        const stored = await sink.store({
          content: part.data,
          contentType: part.contentType || DEFAULT_CONTENT_TYPE,
        });
        const artifact: PublishArtifactRequest = {
          filename,
          size: stored.size,
          sha256: stored.sha256,
          contentType: part.contentType || DEFAULT_CONTENT_TYPE,
          metadata: {},
        };
        upload = { artifact, storedKey: stored.key };
      }

      // twine sends file_upload; the other legacy actions register metadata
      // without a file, which this repository has nothing to do with.
      const action = fields.get(":action");
      if (action !== undefined && action !== "file_upload") {
        throw new ValidationError(`PyPI upload action is not supported: ${action}`);
      }
      if (!upload) {
        throw new ValidationError("PyPI upload does not carry a distribution");
      }
      requireDeclaredDigestMatches(fields, upload.artifact.sha256);

      return [upload];
    }),

    // twine treats any 2xx as success and shows the body on failure.
    successResponse: () => new Response(null, { status: 200 }),
  };
}

function multipartBoundary(request: Request): string | undefined {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(request.headers.get("content-type") ?? "");
  return match?.slice(1).find(Boolean)?.trim();
}

async function readField(content: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.byteLength;
    if (size > MAX_FIELD_BYTES) {
      throw new ValidationError("PyPI upload form field is too large");
    }
    chunks.push(chunk);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Checks the digest the client says it sent against what arrived.
 *
 * twine computes these before uploading, so a mismatch means the bytes changed
 * on the way and the publish should fail rather than storing them.
 */
function requireDeclaredDigestMatches(fields: Map<string, string>, sha256: string): void {
  const declared = fields.get("sha256_digest");
  if (declared && declared.toLowerCase() !== sha256) {
    throw new ValidationError("PyPI upload does not match the sha256 digest it declared");
  }
}
