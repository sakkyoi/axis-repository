import { createApp } from "./app";
import { AxisAdminDO, type AxisEnv } from "./axis-admin-do";

export { AxisAdminDO };

const fallbackApp = createApp();

export default {
  fetch(request: Request, env?: AxisEnv): Promise<Response> {
    if (env?.AXIS_ADMIN) {
      const id = env.AXIS_ADMIN.idFromName("global");
      return env.AXIS_ADMIN.get(id).fetch(request);
    }
    return fallbackApp.fetch(request);
  },
};
