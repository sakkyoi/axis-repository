import { createDevDependencies, type AppDependencies } from "./dev-dependencies";
import type { AxisApp } from "./routes";
import { dispatch, errorResponse } from "./routes";

export function createApp(dependencies: AppDependencies = createDevDependencies()): AxisApp {
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return await dispatch(request, dependencies);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
