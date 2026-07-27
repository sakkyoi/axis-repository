import { isStringArray } from "../http";
import {
  UnauthorizedError,
  timingSafeEqualText,
  type AdminAccessTokenCodec,
  type AdminPrincipal,
} from "@axis-repository/core";

const textEncoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(secret: string, payload: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), textEncoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

export class HmacAdminAccessTokenCodec implements AdminAccessTokenCodec {
  constructor(private readonly secret: string, private readonly now: () => Date = () => new Date()) {
    if (!secret) {
      throw new Error("AXIS_SESSION_SECRET is required for AxisAdminDO");
    }
  }

  async create(principal: AdminPrincipal, expiresAt: Date): Promise<string> {
    const payload = bytesToBase64Url(textEncoder.encode(JSON.stringify({
      type: principal.type,
      sub: principal.subject,
      username: principal.username,
      role: principal.role,
      scopes: principal.scopes,
      sid: principal.sessionId,
      exp: Math.floor(expiresAt.getTime() / 1000),
    })));
    return `${payload}.${await hmacSign(this.secret, payload)}`;
  }

  async verify(token: string): Promise<AdminPrincipal> {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) {
      throw new UnauthorizedError();
    }
    if (!timingSafeEqualText(signature, await hmacSign(this.secret, payload))) {
      throw new UnauthorizedError();
    }
    let claims: unknown;
    try {
      claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    } catch {
      throw new UnauthorizedError();
    }
    if (!claims || typeof claims !== "object") {
      throw new UnauthorizedError();
    }
    const record = claims as Record<string, unknown>;
    if (
      record.type !== "admin"
      || typeof record.sub !== "string"
      || typeof record.username !== "string"
      || record.role !== "owner"
      || typeof record.sid !== "string"
      || !isStringArray(record.scopes)
      || typeof record.exp !== "number"
      || record.exp * 1000 <= this.now().getTime()
    ) {
      throw new UnauthorizedError();
    }
    return {
      type: "admin",
      subject: record.sub,
      username: record.username,
      role: record.role,
      scopes: [...record.scopes],
      sessionId: record.sid,
    };
  }
}

export const adminRefreshCookieName = "axis_admin_refresh";

/**
 * Whether the refresh cookie may be marked `Secure`.
 *
 * A browser silently discards a `Secure` cookie that arrives over a plain HTTP
 * origin, and reports nothing. Marking it unconditionally means signing in over
 * `http://<host>` appears to work — the access token lives in memory — and then
 * reloading the page drops straight back to the login screen, because there is
 * no cookie left to exchange for a new one. Only `localhost` escapes that, and
 * only in some browsers.
 *
 * The scheme is read from the request URL rather than a forwarded header, so a
 * client cannot talk the server out of the flag on a deployment that really is
 * served over HTTPS.
 */
export function requestIsSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function adminRefreshCookie(input: {
  refreshToken: string;
  expiresAt: string;
  secure: boolean;
}): string {
  return [
    `${adminRefreshCookieName}=${input.refreshToken}`,
    "Path=/admin/auth",
    "HttpOnly",
    ...(input.secure ? ["Secure"] : []),
    "SameSite=Lax",
    `Expires=${new Date(input.expiresAt).toUTCString()}`,
  ].join("; ");
}

export function clearAdminRefreshCookie(secure: boolean): string {
  // The attributes have to match the cookie being cleared, or the browser
  // treats this as a different cookie and leaves the original in place.
  return [
    `${adminRefreshCookieName}=`,
    "Path=/admin/auth",
    "HttpOnly",
    ...(secure ? ["Secure"] : []),
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function refreshTokenFromCookie(request: Request): string | undefined {
  const cookie = request.headers.get("cookie");
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === adminRefreshCookieName) {
      return valueParts.join("=");
    }
  }
  return undefined;
}
