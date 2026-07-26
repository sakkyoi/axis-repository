import { createApp } from "./worker/app";
import { AxisAdminDO, type AxisEnv } from "./worker/axis-admin-do";
import { createDevDependencies } from "./worker/dev-dependencies";

export { AxisAdminDO };

const fallbackApps = new Map<string, ReturnType<typeof createApp>>();

function fallbackAppFor(env?: AxisEnv): ReturnType<typeof createApp> {
  const apiBaseUrl = env?.ADMIN_UI_API_BASE_URL ?? "";
  const cached = fallbackApps.get(apiBaseUrl);
  if (cached) return cached;
  const app = createApp(createDevDependencies(undefined, { apiBaseUrl }));
  fallbackApps.set(apiBaseUrl, app);
  return app;
}

export default {
  fetch(request: Request, env?: AxisEnv): Promise<Response> {
    if (env?.AXIS_ADMIN) {
      const id = env.AXIS_ADMIN.idFromName("global");
      return env.AXIS_ADMIN.get(id).fetch(request);
    }
    return fallbackAppFor(env).fetch(request);
  },
};
