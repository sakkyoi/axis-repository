import {
  UnauthorizedError,
  ValidationError,
  parseBearerToken,
  type AdminAuthService,
  type AdminPrincipal,
} from "@axis-repository/core";

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

/**
 * Reads a publish token out of HTTP Basic credentials.
 *
 * Ecosystem upload clients authenticate this way — `twine` sends `__token__`
 * as the username and the token as the password. The username is not checked,
 * so a token pasted under any name works, matching what those clients do.
 */
export function requireBasicAuthSecret(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const encoded = /^Basic\s+(\S+)$/i.exec(header)?.[1];
  if (!encoded) {
    throw new UnauthorizedError();
  }

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new UnauthorizedError();
  }

  const secret = decoded.slice(decoded.indexOf(":") + 1);
  if (!decoded.includes(":") || !secret) {
    throw new UnauthorizedError();
  }
  return secret;
}

export function requireAdmin(request: Request, adminAuthService: AdminAuthService): Promise<AdminPrincipal> {
  const token = requireBearer(request);
  return adminAuthService.verifyAccessToken(token);
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

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function stringArrayField(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!isStringArray(value) || value.some((item) => !item.trim()) || value.length === 0) {
    throw new ValidationError(`${key} must be a non-empty string array`);
  }
  return value;
}
