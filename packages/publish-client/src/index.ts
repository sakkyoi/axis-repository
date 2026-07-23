import type { PublishArtifactRequest, PublishSession, UploadTarget, VerifiedUpload } from "@axis-repository/core";

export interface PublishClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

export interface PublishArtifactInput extends PublishArtifactRequest {
  body: NonNullable<RequestInit["body"]>;
}

export interface PublishArtifactsInput {
  repository: string;
  artifacts: PublishArtifactInput[];
}

export interface PublishArtifactsResult {
  session: PublishSession;
}

export interface PublishClient {
  baseUrl: string;
  publishArtifacts(input: PublishArtifactsInput): Promise<PublishArtifactsResult>;
}

export function createPublishClient(options: PublishClientOptions): PublishClient {
  const baseUrl = options.baseUrl.replace(/\/+$/g, "");
  const fetchImpl = options.fetch ?? fetch;

  async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Axis publish request failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as T;
  }

  async function uploadArtifact(target: UploadTarget, artifact: PublishArtifactInput): Promise<void> {
    const response = await fetchImpl(target.url, {
      method: target.method,
      headers: target.headers,
      body: artifact.body,
    });

    if (!response.ok) {
      throw new Error(`Axis artifact upload failed: ${response.status} ${await response.text()}`);
    }
  }

  return {
    baseUrl,
    async publishArtifacts(input) {
      const create = await requestJson<{ session: PublishSession }>("/api/publish-sessions", {
        method: "POST",
        body: JSON.stringify({
          repository: input.repository,
          artifacts: input.artifacts.map(({ body: _body, ...artifact }) => artifact),
        }),
      });
      const session = create.session;

      for (const target of session.uploads) {
        const artifact = input.artifacts.find((candidate) => candidate.filename === target.filename);
        if (!artifact) {
          throw new Error(`Axis publish session returned upload for unknown artifact: ${target.filename}`);
        }

        await uploadArtifact(target, artifact);
        await requestJson<{ session: PublishSession; verified: VerifiedUpload }>(
          `/api/publish-sessions/${encodeURIComponent(session.id)}/uploads/${encodeURIComponent(target.uploadId)}/verify`,
          { method: "POST", body: "{}" },
        );
      }

      return await requestJson<PublishArtifactsResult>(
        `/api/publish-sessions/${encodeURIComponent(session.id)}/finalize`,
        { method: "POST", body: "{}" },
      );
    },
  };
}
