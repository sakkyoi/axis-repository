#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { createPublishClient } from "./index";

export interface PublishRequestFile {
  baseUrl: string;
  tokenEnv?: string;
  token?: string;
  repository: string;
  artifacts: Array<{
    path: string;
    filename?: string;
    contentType: string;
    metadata: Record<string, unknown>;
  }>;
}

export function parseCliArgs(args: string[]): { requestPath: string } {
  const requestIndex = args.indexOf("--request");
  const requestPath = requestIndex >= 0 ? args[requestIndex + 1] : undefined;
  if (!requestPath) {
    throw new Error("Usage: axis-publish --request <publish.json>");
  }

  return { requestPath };
}

export function parsePublishRequest(json: string): PublishRequestFile {
  const parsed = JSON.parse(json) as PublishRequestFile;
  if (!parsed.baseUrl) {
    throw new Error("baseUrl is required");
  }
  if (!parsed.repository) {
    throw new Error("repository is required");
  }
  if (!Array.isArray(parsed.artifacts) || parsed.artifacts.length === 0) {
    throw new Error("artifacts are required");
  }

  return parsed;
}

async function fileSha256(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function runCli(args = process.argv.slice(2), env = process.env): Promise<void> {
  const { requestPath } = parseCliArgs(args);
  const request = parsePublishRequest(await readFile(requestPath, "utf8"));
  const tokenEnv = request.tokenEnv ?? "AXIS_PUBLISH_TOKEN";
  const token = request.token ?? env[tokenEnv];
  if (!token) {
    throw new Error(`Publish token is required in ${tokenEnv}`);
  }

  const artifacts = await Promise.all(
    request.artifacts.map(async (artifact) => {
      const bytes = await readFile(artifact.path);
      return {
        filename: artifact.filename ?? basename(artifact.path),
        contentType: artifact.contentType,
        size: bytes.byteLength,
        sha256: await fileSha256(bytes),
        body: new Blob([bytes]),
        metadata: artifact.metadata,
      };
    }),
  );

  const result = await createPublishClient({ baseUrl: request.baseUrl, token }).publishArtifacts({
    repository: request.repository,
    artifacts,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
