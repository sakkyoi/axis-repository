import { describe, expect, it } from "vitest";
import {
  MemoryStateStore,
  RepositoryActivityService,
  RepositoryService,
  type BackgroundJobRecord,
  type Clock,
  type RandomId,
} from "@axis-repository/core";
import {
  assertBackgroundJobQueueConfiguration,
  drainBackgroundJobQueue,
  enqueueBackgroundJobWakeup,
  type BackgroundJobQueueMessage,
} from "./background-job-queue";
import { BackgroundJobDispatcher } from "./background-job-dispatcher";
import { RepositoryIndexBackgroundJobService } from "./repository-index-background-job-service";

class FakeQueue {
  readonly messages: BackgroundJobQueueMessage[] = [];

  async send(message: BackgroundJobQueueMessage): Promise<QueueSendResponse> {
    this.messages.push(message);
    return {} as QueueSendResponse;
  }

  sendBatch(): Promise<QueueSendBatchResponse> {
    throw new Error("Not implemented");
  }
}

describe("background job queue", () => {
  it("requires shared D1 state when a queue binding is configured", () => {
    expect(() => assertBackgroundJobQueueConfiguration({
      AXIS_BACKGROUND_JOBS: new FakeQueue() as unknown as Queue,
    })).toThrow("AXIS_SHARED_STATE is required when AXIS_BACKGROUND_JOBS is bound");
  });

  it("enqueues a small wake-up message", async () => {
    const queue = new FakeQueue();

    await enqueueBackgroundJobWakeup({
      AXIS_BACKGROUND_JOBS: queue as unknown as Queue,
    }, new Date("2026-08-05T00:00:00.000Z"));

    expect(queue.messages).toEqual([{ enqueuedAt: "2026-08-05T00:00:00.000Z" }]);
  });

  it("re-enqueues a wake-up when runnable work remains", async () => {
    const queue = new FakeQueue();
    const calls: number[] = [];

    await drainBackgroundJobQueue({
      queue: queue as unknown as Queue<BackgroundJobQueueMessage>,
      dependencies: {
        backgroundJobDispatcher: {
          drain: async (input) => {
            calls.push(input?.limit ?? 0);
            return { processed: 1, failed: 0, remaining: 1 };
          },
        },
      },
    });

    expect(calls).toEqual([1]);
    expect(queue.messages).toHaveLength(1);
  });

  it("does not re-enqueue after the last runnable job", async () => {
    const queue = new FakeQueue();

    await drainBackgroundJobQueue({
      queue: queue as unknown as Queue<BackgroundJobQueueMessage>,
      dependencies: {
        backgroundJobDispatcher: {
          drain: async () => ({ processed: 1, failed: 0, remaining: 0 }),
        },
      },
    });

    expect(queue.messages).toEqual([]);
  });

  it("runs a repository index proxy refresh slice through the queue consumer path", async () => {
    const state = new MemoryStateStore();
    const clock: Clock = { now: () => new Date("2026-08-05T00:00:00.000Z") };
    const randomId: RandomId = { create: (prefix) => `${prefix}_1` };
    const queue = new FakeQueue();
    const job: BackgroundJobRecord = {
      id: "repository.index:python-proxy",
      type: "repository.index.proxy-refresh",
      status: "pending",
      subject: { type: "repository", id: "python-proxy", repositoryName: "python-proxy" },
      repositoryName: "python-proxy",
      priority: 0,
      attempts: 0,
      requestedAt: "2026-08-05T00:00:00.000Z",
      scheduledAt: "2026-08-05T00:00:00.000Z",
    };
    await state.backgroundJobs.save(job);
    const rebuilt: string[] = [];
    const repositoryIndexJobService = new RepositoryIndexBackgroundJobService({
      state,
      clock,
      repositoryService: new RepositoryService({ state, clock, randomId }),
      repositoryActivityService: new RepositoryActivityService({ state, clock, randomId }),
      repositoryArtifactIndexService: {
        rebuild: async ({ repositoryName }) => {
          rebuilt.push(repositoryName);
          return { artifacts: [], artifactCount: 0 };
        },
      },
    });
    const dispatcher = new BackgroundJobDispatcher({
      state,
      clock,
      createLeaseId: () => "lease_fixed",
      runners: [{
        supports: (candidate) => candidate.type.startsWith("repository.index."),
        run: (candidate) => repositoryIndexJobService.runBackgroundJob(candidate),
      }],
    });

    await drainBackgroundJobQueue({
      queue: queue as unknown as Queue<BackgroundJobQueueMessage>,
      dependencies: { backgroundJobDispatcher: dispatcher },
    });

    expect(rebuilt).toEqual(["python-proxy"]);
    await expect(state.backgroundJobs.get("repository.index:python-proxy")).resolves.toMatchObject({
      status: "succeeded",
      attempts: 1,
      result: { artifactCount: 0 },
    });
    expect(await state.repositoryActivities.listByRepository("python-proxy")).toMatchObject([{
      type: "artifact-index.rebuild",
      metadata: { artifactCount: 0 },
    }]);
    expect(queue.messages).toEqual([]);
  });
});
