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
      || !Array.isArray(record.scopes)
      || record.scopes.some((scope) => typeof scope !== "string")
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
      scopes: [...record.scopes] as string[],
      sessionId: record.sid,
    };
  }
}

export const adminRefreshCookieName = "axis_admin_refresh";

export function adminRefreshCookie(refreshToken: string, expiresAt: string): string {
  return [
    `${adminRefreshCookieName}=${refreshToken}`,
    "Path=/admin/auth",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

export function clearAdminRefreshCookie(): string {
  return `${adminRefreshCookieName}=; Path=/admin/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
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
