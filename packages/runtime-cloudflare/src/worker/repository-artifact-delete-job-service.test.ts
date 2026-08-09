import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  RepositoryService,
  type Clock,
  type RandomId,
  type RepositoryArtifactRecord,
  type RepositoryArtifactStore,
} from "@axis-repository/core";
import { RepositoryArtifactDeleteJobService } from "./repository-artifact-delete-job-service";

const clock: Clock = {
  now: () => new Date("2026-08-05T00:00:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix) => `${prefix}_fixed`,
};

describe("RepositoryArtifactDeleteJobService", () => {
  it("requests a delete job without scanning every repository artifact", async () => {
    const state = new MemoryStateStore();
    const repositoryService = new RepositoryService({ state, clock, randomId });
    await repositoryService.create({
      name: "python-proxy",
      ecosystem: "pypi",
      kind: "proxy",
      config: { pypi: { upstreamUrl: "https://pypi.example/simple/", upstreamUrlMode: "simple-api-root" } },
    });
    const artifact = repositoryArtifact({ repositoryName: "python-proxy" });
    const artifactStore: RepositoryArtifactStore & {
      getById(id: string): Promise<RepositoryArtifactRecord | null>;
    } = {
      getById: async (id) => id === artifact.id ? artifact : null,
      countByRepository: async () => 1,
      listByRepository: async () => {
        throw new Error("listByRepository should not be needed to request a delete job");
      },
      listFamiliesByRepositoryPage: async () => ({ records: [], totalFamilies: 0, totalArtifacts: 0 }),
      listByRepositoryPage: async () => ({ records: [], total: 0 }),
      listByRepositoryFamily: async () => [],
      upsert: async () => {},
      upsertMany: async () => {},
      replaceByRepository: async () => {},
    };
    const service = new RepositoryArtifactDeleteJobService({
      state,
      repositoryService,
      repositoryArtifactStore: artifactStore,
      repositoryArtifactIndexService: {
        deleteArtifact: async () => {
          throw new Error("not used by request");
        },
      } as never,
      repositoryActivityService: {
        recordArtifactDelete: async () => {
          throw new Error("not used by request");
        },
        recordArtifactIndexRebuild: async () => {
          throw new Error("not used by request");
        },
      } as never,
      clock,
    });

    await expect(service.request({
      repositoryName: "python-proxy",
      artifactId: artifact.id,
    })).resolves.toMatchObject({
      id: "repository.artifact.delete:python-proxy:artifact_1",
      status: "pending",
      result: {
        artifactIdentity: "pypi:demo:1.0.0",
      },
    });
  });
});

function repositoryArtifact(overrides: Partial<RepositoryArtifactRecord> = {}): RepositoryArtifactRecord {
  return {
    id: "artifact_1",
    repositoryName: "python-proxy",
    ecosystem: "pypi",
    identity: "pypi:demo:1.0.0",
    family: "pypi:demo",
    name: "demo",
    version: "1.0.0",
    summary: "demo 1.0.0",
    objectKeys: ["repositories/python-proxy/simple/demo/demo-1.0.0.whl"],
    metadata: {},
    primaryObjectKey: "repositories/python-proxy/simple/demo/demo-1.0.0.whl",
    publishedAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}
