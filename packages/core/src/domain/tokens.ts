import { UnauthorizedError } from "./errors";

export function parseBearerToken(header: string | null): string {
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError();
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new UnauthorizedError();
  }
  return token;
}

export function timingSafeEqualText(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Extracts the record id from a secret shaped `<prefix><id>.<random>`.
 *
 * Secrets embed the id of the record they authenticate so verification is a
 * single lookup instead of a scan that hashes every stored record. Returns
 * undefined for secrets issued before this format, which still verify through
 * the scanning fallback.
 */
export function tokenLookupId(secret: string, prefix: string): string | undefined {
  if (!secret.startsWith(prefix)) {
    return undefined;
  }
  const rest = secret.slice(prefix.length);
  const separator = rest.indexOf(".");
  if (separator <= 0) {
    return undefined;
  }
  return rest.slice(0, separator);
}
