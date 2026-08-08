import { ValidationError } from "@axis-repository/core";
import type { AxisEnv } from "./axis-admin-do";
import type { BackgroundJobDispatcher } from "./background-job-dispatcher";

export interface BackgroundJobQueueMessage {
  enqueuedAt: string;
}

export function assertBackgroundJobQueueConfiguration(env: AxisEnv): void {
  if (env.AXIS_BACKGROUND_JOBS !== undefined && env.AXIS_SHARED_STATE === undefined) {
    throw new Error("AXIS_SHARED_STATE is required when AXIS_BACKGROUND_JOBS is bound");
  }
  if (env.AXIS_SHARED_STATE !== undefined && env.AXIS_BACKGROUND_JOBS === undefined) {
    throw new Error("AXIS_BACKGROUND_JOBS is required when AXIS_SHARED_STATE is bound");
  }
}

export async function enqueueBackgroundJobWakeup(env: AxisEnv, now: Date = new Date()): Promise<void> {
  if (env.AXIS_BACKGROUND_JOBS === undefined) {
    throw new ValidationError("Background job queue is not configured");
  }
  await env.AXIS_BACKGROUND_JOBS.send({ enqueuedAt: now.toISOString() } satisfies BackgroundJobQueueMessage);
}

export async function drainBackgroundJobQueue(input: {
  dependencies: { backgroundJobDispatcher: Pick<BackgroundJobDispatcher, "drain"> };
  queue: Queue<BackgroundJobQueueMessage>;
  limit?: number;
}): Promise<void> {
  const result = await input.dependencies.backgroundJobDispatcher.drain({ limit: input.limit ?? 1 });
  if (result.remaining > 0) {
    await input.queue.send({ enqueuedAt: new Date().toISOString() });
  }
}

export async function drainBackgroundJobQueueBatch(input: {
  dependencies: { backgroundJobDispatcher: Pick<BackgroundJobDispatcher, "drain"> };
  queue: Queue<BackgroundJobQueueMessage>;
  messages: readonly BackgroundJobQueueMessage[];
  limit?: number;
}): Promise<void> {
  if (input.messages.length === 0) {
    return;
  }
  await drainBackgroundJobQueue({
    dependencies: input.dependencies,
    queue: input.queue,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
}
