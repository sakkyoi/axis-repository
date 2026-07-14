import type {
  Ecosystem,
  PublishArtifactRequest,
  PublishSession,
  TokenPrincipal,
  UploadedObject,
} from "./domain";
import { ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { Clock, RandomId, StateStore, UploadBroker } from "./ports";

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

export interface PublishSessionServiceOptions {
  state: StateStore;
  uploadBroker: UploadBroker;
  clock: Clock;
  randomId: RandomId;
  ttlSeconds?: number;
}

export class PublishSessionService {
  private readonly ttlSeconds: number;

  constructor(private readonly options: PublishSessionServiceOptions) {
    this.ttlSeconds = options.ttlSeconds ?? 15 * 60;
  }

  async create(input: CreatePublishSessionInput): Promise<PublishSession> {
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
    if (input.artifacts.length === 0) {
      throw new ValidationError("At least one artifact is required");
    }

    const now = this.options.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlSeconds * 1000);
    const sessionId = this.options.randomId.create("pub");
    const uploads = [];

    for (const artifact of input.artifacts) {
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
      status: "created",
      requestedBy: input.principal,
      artifacts: input.artifacts.map((artifact) => ({
        ...artifact,
        metadata: { ...artifact.metadata },
      })),
      uploads,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.options.state.publishSessions.save(session);
    return session;
  }

  async verifyUpload(input: VerifyPublishUploadInput): Promise<UploadedObject> {
    const session = await this.options.state.publishSessions.get(input.sessionId);
    if (!session) {
      throw new NotFoundError(`Publish session not found: ${input.sessionId}`);
    }
    if (session.status !== "created") {
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

    return this.options.uploadBroker.verifyUpload({ target, expected });
  }
}
