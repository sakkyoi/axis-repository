import type {
  Ecosystem,
  PublishArtifactRequest,
  PublishResult,
  PublishSession,
  TokenPrincipal,
  VerifiedUpload,
} from "./domain";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { ArtifactPublisher, Clock, RandomId, StateStore, UploadBroker } from "./ports";

export interface CreatePublishSessionInput {
  repositoryName: string;
  ecosystem: Ecosystem;
  principal: TokenPrincipal;
  artifacts: PublishArtifactRequest[];
}

export interface VerifyPublishUploadInput {
  sessionId: string;
  uploadId: string;
  principal: TokenPrincipal;
}

export interface VerifyPublishUploadResult {
  upload: VerifiedUpload;
  session: PublishSession;
}

export interface FinalizePublishSessionInput {
  sessionId: string;
  principal: TokenPrincipal;
}

export interface FinalizePublishSessionResult {
  session: PublishSession;
  result: PublishResult;
}

export interface PublishSessionServiceOptions {
  state: StateStore;
  uploadBroker: UploadBroker;
  artifactPublisher?: ArtifactPublisher;
  clock: Clock;
  randomId: RandomId;
  ttlSeconds?: number;
}

function cloneMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneMetadataValue);
  }
  if (isPlainRecord(value)) {
    return cloneMetadataRecord(value);
  }
  return value;
}

function cloneMetadataRecord(metadata: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, cloneMetadataValue(value)]));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function verifiedUploadsFor(session: PublishSession): VerifiedUpload[] {
  return session.verifiedUploads ?? [];
}

function normalizeOpenStatus(status: PublishSession["status"] | "created"): PublishSession["status"] {
  return status === "created" ? "pending_uploads" : status;
}

function allUploadsVerified(session: PublishSession, verifiedUploads: VerifiedUpload[]): boolean {
  return session.uploads.every((upload) =>
    verifiedUploads.some((verifiedUpload) => verifiedUpload.uploadId === upload.uploadId),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PublishSessionService {
  private readonly ttlSeconds: number;

  constructor(private readonly options: PublishSessionServiceOptions) {
    this.ttlSeconds = options.ttlSeconds ?? 15 * 60;
  }

  async create(input: CreatePublishSessionInput): Promise<PublishSession> {
    const artifacts = input.artifacts.map((artifact) => ({
      ...artifact,
      metadata: cloneMetadataRecord(artifact.metadata),
    }));

    const repository = await this.options.state.repositories.getByName(input.repositoryName);
    if (!repository) {
      throw new NotFoundError(`Repository not found: ${input.repositoryName}`);
    }
    if (repository.ecosystem !== input.ecosystem) {
      throw new ValidationError(`Repository ${repository.name} is not a ${input.ecosystem} repository`);
    }
    if (!input.principal.permissions.includes("publish")) {
      throw new ForbiddenError("Publish permission is required");
    }
    if (!input.principal.repositories.includes(repository.name)) {
      throw new ForbiddenError(`Token is not scoped to repository: ${repository.name}`);
    }
    if (artifacts.length === 0) {
      throw new ValidationError("At least one artifact is required");
    }

    const now = this.options.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const sessionId = this.options.randomId.create("pub");
    const uploads = [];

    for (const artifact of artifacts) {
      const uploadId = this.options.randomId.create("upl");
      uploads.push(
        await this.options.uploadBroker.createUploadTarget({
          sessionId,
          uploadId,
          artifact,
          expiresAt,
        }),
      );
    }

    const session: PublishSession = {
      id: sessionId,
      repositoryName: repository.name,
      ecosystem: repository.ecosystem,
      status: "pending_uploads",
      requestedBy: input.principal,
      artifacts,
      uploads,
      verifiedUploads: [],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.options.state.publishSessions.save(session);
    return session;
  }

  async verifyUpload(input: VerifyPublishUploadInput): Promise<VerifyPublishUploadResult> {
    const session = await this.options.state.publishSessions.get(input.sessionId);
    if (!session) {
      throw new NotFoundError(`Publish session not found: ${input.sessionId}`);
    }
    const openStatus = normalizeOpenStatus(session.status);
    if (openStatus !== "pending_uploads" && openStatus !== "ready") {
      throw new ValidationError(`Publish session is not open: ${session.status}`);
    }
    if (new Date(session.expiresAt).getTime() <= this.options.clock.now().getTime()) {
      throw new ValidationError("Publish session has expired");
    }
    if (!input.principal.permissions.includes("publish")) {
      throw new ForbiddenError("Publish permission is required");
    }
    if (!input.principal.repositories.includes(session.repositoryName)) {
      throw new ForbiddenError(`Token is not scoped to repository: ${session.repositoryName}`);
    }

    const uploadIndex = session.uploads.findIndex((upload) => upload.uploadId === input.uploadId);
    if (uploadIndex === -1) {
      throw new NotFoundError(`Upload not found: ${input.uploadId}`);
    }

    const target = session.uploads[uploadIndex];
    const expected = session.artifacts[uploadIndex];
    if (!target || !expected) {
      throw new ValidationError(`Upload is not paired with an artifact: ${input.uploadId}`);
    }

    const uploaded = await this.options.uploadBroker.verifyUpload({ target, expected });
    const upload: VerifiedUpload = {
      ...uploaded,
      verifiedAt: this.options.clock.now().toISOString(),
    };
    const verifiedUploads = [
      ...verifiedUploadsFor(session).filter((verifiedUpload) => verifiedUpload.uploadId !== upload.uploadId),
      upload,
    ];
    const updatedSession: PublishSession = {
      ...session,
      status: allUploadsVerified(session, verifiedUploads) ? "ready" : "pending_uploads",
      verifiedUploads,
    };

    await this.options.state.publishSessions.save(updatedSession);

    return {
      upload,
      session: updatedSession,
    };
  }

  async finalize(input: FinalizePublishSessionInput): Promise<FinalizePublishSessionResult> {
    const session = await this.options.state.publishSessions.get(input.sessionId);
    if (!session) {
      throw new NotFoundError(`Publish session not found: ${input.sessionId}`);
    }
    if (!input.principal.permissions.includes("publish")) {
      throw new ForbiddenError("Publish permission is required");
    }
    if (!input.principal.repositories.includes(session.repositoryName)) {
      throw new ForbiddenError(`Token is not scoped to repository: ${session.repositoryName}`);
    }
    if (session.status !== "ready") {
      throw new ValidationError(`Publish session is not ready: ${session.status}`);
    }

    const repository = await this.options.state.repositories.getByName(session.repositoryName);
    if (!repository) {
      throw new NotFoundError(`Repository not found: ${session.repositoryName}`);
    }

    const artifactPublisher = this.options.artifactPublisher;
    if (!artifactPublisher) {
      throw new ValidationError("Artifact publisher is not configured");
    }

    const verifiedUploads = verifiedUploadsFor(session);
    const artifacts = session.uploads.map((upload, index) => {
      const artifact = session.artifacts[index];
      const verifiedUpload = verifiedUploads.find((candidate) => candidate.uploadId === upload.uploadId);
      if (!artifact || !verifiedUpload) {
        throw new ValidationError("All uploads must be verified before finalize");
      }
      return {
        artifact,
        upload: verifiedUpload,
      };
    });

    const finalizingSession: PublishSession = {
      ...session,
      status: "finalizing",
    };
    await this.options.state.publishSessions.save(finalizingSession);

    try {
      const result = await artifactPublisher.publish({
        repository,
        session: finalizingSession,
        artifacts,
      });
      const finalizedSession: PublishSession = {
        ...finalizingSession,
        status: "finalized",
        finalizedAt: this.options.clock.now().toISOString(),
        publishResult: result,
      };
      await this.options.state.publishSessions.save(finalizedSession);

      return {
        session: finalizedSession,
        result,
      };
    } catch (error) {
      const failedSession: PublishSession = {
        ...finalizingSession,
        status: "failed",
        failure: {
          message: errorMessage(error),
          failedAt: this.options.clock.now().toISOString(),
        },
      };
      await this.options.state.publishSessions.save(failedSession);
      throw error;
    }
  }
}
