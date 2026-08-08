import { AxisAdminDO, type AxisEnv } from "./worker/axis-admin-do";
import { createDurableObjectDependencies } from "./worker/axis-admin-do";
import { drainBackgroundJobQueue, drainBackgroundJobQueueBatch, type BackgroundJobQueueMessage } from "./worker/background-job-queue";
import type { DurableStorage } from "./storage/durable-state";

export { AxisAdminDO };

// The Durable Object owns all persistent state, auth, and secrets. Without its
// binding there is no safe way to serve a request, so refuse rather than fall
// back to an unauthenticated in-memory app.
function missingAdminBindingResponse(): Response {
  console.error("AXIS_ADMIN Durable Object binding is not configured; refusing to serve requests");
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

export default {
  fetch(request: Request, env?: AxisEnv): Promise<Response> {
    if (!env?.AXIS_ADMIN) {
      return Promise.resolve(missingAdminBindingResponse());
    }
    const id = env.AXIS_ADMIN.idFromName("global");
    return env.AXIS_ADMIN.get(id).fetch(request);
  },
  async queue(batch: MessageBatch<BackgroundJobQueueMessage>, env: AxisEnv): Promise<void> {
    if (!env.AXIS_SHARED_STATE || !env.AXIS_BACKGROUND_JOBS) {
      throw new Error("AXIS_SHARED_STATE and AXIS_BACKGROUND_JOBS are required for background job queue consumers");
    }
    const dependencies = createDurableObjectDependencies(unavailableDurableStorage, env, {
      scheduleBackgroundJobs: () => drainBackgroundJobQueue({
        dependencies,
        queue: env.AXIS_BACKGROUND_JOBS!,
      }),
    });
    await drainBackgroundJobQueueBatch({
      dependencies,
      queue: env.AXIS_BACKGROUND_JOBS,
      messages: batch.messages.map((message) => message.body),
    });
  },
};

const unavailableDurableStorage: DurableStorage = {
  get: async () => {
    throw new Error("Durable Object storage is unavailable in the background job queue consumer");
  },
  put: async () => {
    throw new Error("Durable Object storage is unavailable in the background job queue consumer");
  },
  delete: async () => {
    throw new Error("Durable Object storage is unavailable in the background job queue consumer");
  },
  list: async () => {
    throw new Error("Durable Object storage is unavailable in the background job queue consumer");
  },
};
