import { AxisAdminDO, type AxisEnv } from "./worker/axis-admin-do";

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
    { status: 503, headers: { "content-type": "application/json; charset=utf-8" } },
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
};
