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

export interface ListPublishSessionsInput {
  principal: TokenPrincipal;
}

export interface GetPublishSessionInput {
  sessionId: string;
  principal: TokenPrincipal;
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
  finalizingRetryAfterSeconds?: number;
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

function isExpired(session: PublishSession, now: Date): boolean {
  return new Date(session.expiresAt).getTime() <= now.getTime();
}

export class PublishSessionService {
  private readonly ttlSeconds: number;
  private readonly finalizingRetryAfterSeconds: number;

  constructor(private readonly options: PublishSessionServiceOptions) {
    this.ttlSeconds = options.ttlSeconds ?? 15 * 60;
    this.finalizingRetryAfterSeconds = options.finalizingRetryAfterSeconds ?? 60;
  }

  async list(input: ListPublishSessionsInput): Promise<PublishSession[]> {
    this.requirePublishPermission(input.principal);
    const sessions = await this.options.state.publishSessions.list();
    return sessions.filter((session) =>
      input.principal.repositories.includes(session.repositoryName),
    );
  }

  async get(input: GetPublishSessionInput): Promise<PublishSession> {
    this.requirePublishPermission(input.principal);
    const session = await this.options.state.publishSessions.get(input.sessionId);
    if (!session) {
      throw new NotFoundError(`Publish session not found: ${input.sessionId}`);
    }
    this.requireRepositoryScope(input.principal, session.repositoryName);
    return session;
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
    this.requirePublishPermission(input.principal);
    this.requireRepositoryScope(input.principal, repository.name);
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
    if (isExpired(session, this.options.clock.now())) {
      throw new ValidationError("Publish session has expired");
    }
    this.requirePublishPermission(input.principal);
    this.requireRepositoryScope(input.principal, session.repositoryName);

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

    const updatedSession = await this.options.state.publishSessions.update(session.id, (current) => {
      const currentOpenStatus = normalizeOpenStatus(
        current.status as PublishSession["status"] | "created",
      );
      if (currentOpenStatus !== "pending_uploads" && currentOpenStatus !== "ready") {
        throw new ValidationError(`Publish session is not open: ${current.status}`);
      }
      const verifiedUploads = [
        ...verifiedUploadsFor(current).filter((verifiedUpload) => verifiedUpload.uploadId !== upload.uploadId),
        upload,
      ];
      return {
        ...current,
        status: allUploadsVerified(current, verifiedUploads) ? "ready" : "pending_uploads",
        verifiedUploads,
      };
    });
    if (!updatedSession) {
      throw new NotFoundError(`Publish session not found: ${session.id}`);
    }

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
    this.requirePublishPermission(input.principal);
    this.requireRepositoryScope(input.principal, session.repositoryName);
    if (session.status !== "ready" && session.status !== "finalizing") {
      throw new ValidationError(`Publish session is not ready: ${session.status}`);
    }
    const now = this.options.clock.now();
    if (session.status === "ready" && isExpired(session, now)) {
      throw new ValidationError("Publish session has expired");
    }
    if (session.status === "finalizing" && !this.canRetryFinalizing(session, now)) {
      throw new ValidationError("Publish session is already finalizing");
    }

    const repository = await this.options.state.repositories.getByName(session.repositoryName);
    if (!repository) {
      throw new NotFoundError(`Repository not found: ${session.repositoryName}`);
    }

    const artifactPublisher = this.options.artifactPublisher;
    if (!artifactPublisher) {
      throw new ValidationError("Artifact publisher is not configured");
    }

    const finalizingSession = await this.options.state.publishSessions.update(session.id, (current) => {
      const claimTime = this.options.clock.now();
      if (current.status === "finalizing") {
        if (!this.canRetryFinalizing(current, claimTime)) {
          throw new ValidationError("Publish session is already finalizing");
        }
        return {
          ...current,
          finalizingStartedAt: claimTime.toISOString(),
          publishStartedAt: current.publishStartedAt ?? claimTime.toISOString(),
        };
      }
      if (current.status !== "ready") {
        throw new ValidationError(`Publish session is not ready: ${current.status}`);
      }
      if (isExpired(current, claimTime)) {
        throw new ValidationError("Publish session has expired");
      }
      return {
        ...current,
        status: "finalizing",
        finalizingStartedAt: claimTime.toISOString(),
        publishStartedAt: current.publishStartedAt ?? claimTime.toISOString(),
      };
    });
    if (!finalizingSession) {
      throw new NotFoundError(`Publish session not found: ${input.sessionId}`);
    }

    const verifiedUploads = verifiedUploadsFor(finalizingSession);
    const artifacts = finalizingSession.uploads.map((upload, index) => {
      const artifact = finalizingSession.artifacts[index];
      const verifiedUpload = verifiedUploads.find((candidate) => candidate.uploadId === upload.uploadId);
      if (!artifact || !verifiedUpload) {
        throw new ValidationError("All uploads must be verified before finalize");
      }
      return {
        artifact,
        upload,
        verified: verifiedUpload,
      };
    });

    let result: PublishResult;
    try {
      result = await artifactPublisher.publish({
        repository,
        session: finalizingSession,
        artifacts,
      });
    } catch (error) {
      const failedSession: PublishSession = {
        ...finalizingSession,
        status: "failed",
        failure: {
          message: errorMessage(error),
          failedAt: this.options.clock.now().toISOString(),
        },
      };
      try {
        await this.saveTerminalSession(finalizingSession, failedSession);
      } catch {
        // Preserve the publisher failure as the primary error.
      }
      throw error;
    }

    const finalizedSession: PublishSession = {
      ...finalizingSession,
      status: "finalized",
      finalizedAt: this.options.clock.now().toISOString(),
      publishResult: result,
    };
    await this.saveTerminalSession(finalizingSession, finalizedSession);

    return {
      session: finalizedSession,
      result,
    };
  }

  private canRetryFinalizing(session: PublishSession, now: Date): boolean {
    if (!session.finalizingStartedAt) {
      return true;
    }
    const retryAfterMs = this.finalizingRetryAfterSeconds * 1000;
    return now.getTime() - new Date(session.finalizingStartedAt).getTime() >= retryAfterMs;
  }

  private requirePublishPermission(principal: TokenPrincipal): void {
    if (!principal.permissions.includes("publish")) {
      throw new ForbiddenError("Publish permission is required");
    }
  }

  private requireRepositoryScope(principal: TokenPrincipal, repositoryName: string): void {
    if (!principal.repositories.includes(repositoryName)) {
      throw new ForbiddenError(`Token is not scoped to repository: ${repositoryName}`);
    }
  }

  private async saveTerminalSession(
    finalizingSession: PublishSession,
    terminalSession: PublishSession,
  ): Promise<void> {
    await this.options.state.publishSessions.update(finalizingSession.id, (current) => {
      if (
        current.status !== "finalizing" ||
        current.finalizingStartedAt !== finalizingSession.finalizingStartedAt
      ) {
        throw new ValidationError("Publish session finalizing lease has changed");
      }
      return terminalSession;
    });
  }
}
