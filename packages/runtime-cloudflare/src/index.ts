import { createCloudflareRuntimeDependencies, type AxisEnv } from "./worker/cloudflare-runtime";
import { createApp } from "./worker/app";
import {
  CloudflareBackgroundJobWakeQueue,
  drainBackgroundJobQueue,
  drainBackgroundJobQueueBatch,
  enqueueBackgroundJobWakeup,
  type BackgroundJobQueueMessage,
} from "./worker/background-job-queue";
import { scheduleBackgroundJobs } from "./worker/background-job-scheduler";

function missingRuntimeBindingResponse(message: string): Response {
  console.error(message);
  return new Response(
    JSON.stringify({
      error: { code: "service_unavailable", message: "Service Unavailable" },
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        // This response never reaches the app wrapper that adds these.
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
      },
    },
  );
}

function backgroundJobWakeQueue(env: AxisEnv): CloudflareBackgroundJobWakeQueue {
  return new CloudflareBackgroundJobWakeQueue(env.AXIS_BACKGROUND_JOBS);
}

export default {
  fetch(request: Request, env?: AxisEnv, ctx?: ExecutionContext): Promise<Response> {
    if (!env?.AXIS_SHARED_STATE || !env.AXIS_BACKGROUND_JOBS) {
      return Promise.resolve(missingRuntimeBindingResponse(
        "AXIS_SHARED_STATE and AXIS_BACKGROUND_JOBS are required for the Cloudflare runtime",
      ));
    }
    const dependencies = createCloudflareRuntimeDependencies(env, {
      scheduleBackgroundJobs: () => enqueueBackgroundJobWakeup(backgroundJobWakeQueue(env)),
      ...(ctx === undefined ? {} : { backgroundTasks: { waitUntil: (task) => ctx.waitUntil(task) } }),
    });
    return createApp(dependencies).fetch(request);
  },
  async queue(batch: MessageBatch<BackgroundJobQueueMessage>, env: AxisEnv): Promise<void> {
    if (!env.AXIS_SHARED_STATE || !env.AXIS_BACKGROUND_JOBS) {
      throw new Error("AXIS_SHARED_STATE and AXIS_BACKGROUND_JOBS are required for background job queue consumers");
    }
    const dependencies = createCloudflareRuntimeDependencies(env, {
      scheduleBackgroundJobs: () => enqueueBackgroundJobWakeup(backgroundJobWakeQueue(env)),
    });
    await drainBackgroundJobQueueBatch({
      dependencies,
      wakeQueue: backgroundJobWakeQueue(env),
      messages: batch.messages.map((message) => message.body),
    });
  },
  async scheduled(_controller: ScheduledController, env: AxisEnv, _ctx?: ExecutionContext): Promise<void> {
    if (!env.AXIS_SHARED_STATE || !env.AXIS_BACKGROUND_JOBS) {
      throw new Error("AXIS_SHARED_STATE and AXIS_BACKGROUND_JOBS are required for scheduled background jobs");
    }
    const dependencies = createCloudflareRuntimeDependencies(env, {
      scheduleBackgroundJobs: () => enqueueBackgroundJobWakeup(backgroundJobWakeQueue(env)),
    });
    await scheduleBackgroundJobs({
      stagingUploadGcJobService: dependencies.stagingUploadGcJobService,
      repositoryMaintenanceJobService: dependencies.repositoryMaintenanceJobService,
      wakeQueue: backgroundJobWakeQueue(env),
    });
  },
};
