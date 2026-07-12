import type { AxisApp } from "./routes";
import { dispatch, errorResponse } from "./routes";

export function createApp(): AxisApp {
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return await dispatch(request);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}
