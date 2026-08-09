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
  CloudflareBackgroundJobWakeQueue,
  assertBackgroundJobQueueConfiguration,
  drainBackgroundJobQueueBatch,
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

    await enqueueBackgroundJobWakeup(new CloudflareBackgroundJobWakeQueue(
      queue as unknown as Queue<BackgroundJobQueueMessage>,
      () => new Date("2026-08-05T00:00:00.000Z"),
    ));

    expect(queue.messages).toEqual([{ enqueuedAt: "2026-08-05T00:00:00.000Z" }]);
  });

  it("re-enqueues a wake-up when runnable work remains", async () => {
    const queue = new FakeQueue();
    const calls: number[] = [];

    await drainBackgroundJobQueue({
      wakeQueue: new CloudflareBackgroundJobWakeQueue(queue as unknown as Queue<BackgroundJobQueueMessage>),
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
      wakeQueue: new CloudflareBackgroundJobWakeQueue(queue as unknown as Queue<BackgroundJobQueueMessage>),
      dependencies: {
        backgroundJobDispatcher: {
          drain: async () => ({ processed: 1, failed: 0, remaining: 0 }),
        },
      },
    });

    expect(queue.messages).toEqual([]);
  });

  it("treats a queue delivery batch as one wake-up instead of draining once per message", async () => {
    const queue = new FakeQueue();
    const calls: number[] = [];

    await drainBackgroundJobQueueBatch({
      wakeQueue: new CloudflareBackgroundJobWakeQueue(queue as unknown as Queue<BackgroundJobQueueMessage>),
      messages: [
        { enqueuedAt: "2026-08-05T00:00:00.000Z" },
        { enqueuedAt: "2026-08-05T00:00:01.000Z" },
        { enqueuedAt: "2026-08-05T00:00:02.000Z" },
      ],
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
      wakeQueue: new CloudflareBackgroundJobWakeQueue(queue as unknown as Queue<BackgroundJobQueueMessage>),
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
