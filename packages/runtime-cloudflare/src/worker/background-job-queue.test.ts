import { describe, expect, it } from "vitest";
import {
  assertBackgroundJobQueueConfiguration,
  drainBackgroundJobQueue,
  enqueueBackgroundJobWakeup,
  type BackgroundJobQueueMessage,
} from "./background-job-queue";

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
});
