import type { AppDependencies } from "./dev-dependencies";
import type { AxisApp } from "./routes";
import { dispatch, errorResponse } from "./routes";

const BASELINE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
  ["x-frame-options", "DENY"],
];

function withBaselineSecurityHeaders(response: Response, requestUrl: string): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of BASELINE_SECURITY_HEADERS) {
    if (!secured.headers.has(name)) {
      secured.headers.set(name, value);
    }
  }
  if (requestUrl.startsWith("https://")) {
    secured.headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  return secured;
}

export function createApp(dependencies: AppDependencies): AxisApp {
  return {
    async fetch(request: Request): Promise<Response> {
      try {
        return withBaselineSecurityHeaders(await dispatch(request, dependencies), request.url);
      } catch (error) {
        return withBaselineSecurityHeaders(errorResponse(error), request.url);
      }
    },
  };
}
