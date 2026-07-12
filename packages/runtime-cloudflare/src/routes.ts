import { AxisError, NotFoundError } from "@axis-repository/core";

export interface AxisApp {
  fetch(request: Request): Promise<Response>;
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AxisError) {
    return jsonResponse({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return jsonResponse(
    { error: { code: "internal_error", message: "Internal Server Error" } },
    { status: 500 },
  );
}

export async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return jsonResponse({ ok: true, service: "axis-repository" });
  }
  throw new NotFoundError();
}
