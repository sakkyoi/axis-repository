import { ValidationError, type PublishArtifactRequest } from "@axis-repository/core";
import type {
  ParsedProtocolUpload,
  RepositoryUploadProtocol,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { requireDistributionFilename } from "./names";

/**
 * The upload API `twine` speaks.
 *
 * PyPI's legacy endpoint takes one `multipart/form-data` POST carrying the
 * distribution and a handful of fields describing it. Everything about the
 * publish that follows — validation, the write lock, index generation — is the
 * same as for any other client; only the shape of the request differs.
 */

/**
 * The largest upload accepted here.
 *
 * The runtime's own multipart parser materializes each part, and a worker has
 * 128 MB of heap, so a package larger than this cannot be taken in one
 * request. The publish-session API uploads a file on its own and has no such
 * ceiling, so the error says to use it rather than simply refusing.
 */
export const MAX_PROTOCOL_UPLOAD_BYTES = 96 * 1024 * 1024;

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

export function createPypiUploadProtocol(): RepositoryUploadProtocol {
  return {
    path: "legacy",

    async parseUpload(request: Request): Promise<ParsedProtocolUpload[]> {
      requireAcceptableSize(request);
      const form = await readForm(request);

      const action = stringValue(form, ":action");
      // twine sends file_upload; the other legacy actions register metadata
      // without a file, which this repository has nothing to do with.
      if (action !== undefined && action !== "file_upload") {
        throw new ValidationError(`PyPI upload action is not supported: ${action}`);
      }

      const content = form.get("content");
      if (!(content instanceof File)) {
        throw new ValidationError("PyPI upload does not carry a distribution");
      }
      if (content.size > MAX_PROTOCOL_UPLOAD_BYTES) {
        throw new ValidationError(tooLargeMessage());
      }

      const filename = content.name;
      requireDistributionFilename(filename);
      const body = new Uint8Array(await content.arrayBuffer());
      const sha256 = await sha256Hex(body);
      requireDeclaredDigestMatches(form, sha256);

      const artifact: PublishArtifactRequest = {
        filename,
        size: body.byteLength,
        sha256,
        contentType: content.type || DEFAULT_CONTENT_TYPE,
        metadata: {},
      };
      return [{ artifact, body }];
    },

    // twine treats any 2xx as success and shows the body on failure.
    successResponse: () => new Response(null, { status: 200 }),
  };
}

function requireAcceptableSize(request: Request): void {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_PROTOCOL_UPLOAD_BYTES) {
    throw new ValidationError(tooLargeMessage());
  }
}

function tooLargeMessage(): string {
  return `PyPI upload is larger than ${Math.floor(MAX_PROTOCOL_UPLOAD_BYTES / (1024 * 1024))} MiB;`
    + " publish it through the publish-session API instead";
}

async function readForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new ValidationError("PyPI upload is not a multipart form");
  }
}

function stringValue(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Checks the digest the client says it sent against what arrived.
 *
 * twine computes these before uploading, so a mismatch means the bytes changed
 * on the way and the publish should fail rather than storing them.
 */
function requireDeclaredDigestMatches(form: FormData, sha256: string): void {
  const declared = stringValue(form, "sha256_digest");
  if (declared && declared.toLowerCase() !== sha256) {
    throw new ValidationError("PyPI upload does not match the sha256 digest it declared");
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBufferView);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
