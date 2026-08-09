import { ValidationError, type BackgroundJobWakeQueue } from "@axis-repository/core";
import type { BackgroundJobDispatcher } from "./background-job-dispatcher";

export interface BackgroundJobQueueMessage {
  enqueuedAt: string;
}

export function assertBackgroundJobQueueConfiguration(env: {
  AXIS_SHARED_STATE?: unknown;
  AXIS_BACKGROUND_JOBS?: Queue;
}): void {
  if (env.AXIS_BACKGROUND_JOBS !== undefined && env.AXIS_SHARED_STATE === undefined) {
    throw new Error("AXIS_SHARED_STATE is required when AXIS_BACKGROUND_JOBS is bound");
  }
  if (env.AXIS_SHARED_STATE !== undefined && env.AXIS_BACKGROUND_JOBS === undefined) {
    throw new Error("AXIS_BACKGROUND_JOBS is required when AXIS_SHARED_STATE is bound");
  }
}

export class CloudflareBackgroundJobWakeQueue implements BackgroundJobWakeQueue {
  constructor(
    private readonly queue: Queue<BackgroundJobQueueMessage> | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async wake(): Promise<void> {
    if (this.queue === undefined) {
      throw new ValidationError("Background job queue is not configured");
    }
    await this.queue.send({ enqueuedAt: this.now().toISOString() });
  }
}

export async function enqueueBackgroundJobWakeup(
  wakeQueue: BackgroundJobWakeQueue,
): Promise<void> {
  if (wakeQueue === undefined) {
    throw new ValidationError("Background job queue is not configured");
  }
  await wakeQueue.wake();
}

export async function drainBackgroundJobQueue(input: {
  dependencies: { backgroundJobDispatcher: Pick<BackgroundJobDispatcher, "drain"> };
  wakeQueue: BackgroundJobWakeQueue;
  limit?: number;
}): Promise<void> {
  const result = await input.dependencies.backgroundJobDispatcher.drain({ limit: input.limit ?? 1 });
  if (result.remaining > 0) {
    await input.wakeQueue.wake();
  }
}

export async function drainBackgroundJobQueueBatch(input: {
  dependencies: { backgroundJobDispatcher: Pick<BackgroundJobDispatcher, "drain"> };
  wakeQueue: BackgroundJobWakeQueue;
  messages: readonly BackgroundJobQueueMessage[];
  limit?: number;
}): Promise<void> {
  if (input.messages.length === 0) {
    return;
  }
  await drainBackgroundJobQueue({
    dependencies: input.dependencies,
    wakeQueue: input.wakeQueue,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}
