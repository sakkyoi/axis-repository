import { UnauthorizedError, ValidationError, parseBearerToken, timingSafeEqualText } from "@axis-repository/core";

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function requireBearer(request: Request): string {
  return parseBearerToken(request.headers.get("authorization"));
}

export function requireAdmin(request: Request, adminToken: string): void {
  const token = requireBearer(request);
  if (!timingSafeEqualText(token, adminToken)) {
    throw new UnauthorizedError();
  }
}

export function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`${key} is required`);
  }
  return value;
}

export function optionalObjectField(body: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${key} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function stringArrayField(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ValidationError(`${key} must be a non-empty string array`);
  }
  if (value.length === 0) {
    throw new ValidationError(`${key} must be a non-empty string array`);
  }
  return value;
}
