import type { RandomId, SecretHasher } from "@axis-repository/core";
import { timingSafeEqualText } from "@axis-repository/core";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class WebCryptoRandomId implements RandomId {
  create(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  }
}

export class Sha256SecretHasher implements SecretHasher {
  constructor(private readonly pepper = "") {}

  async hash(secret: string): Promise<string> {
    const data = new TextEncoder().encode(`${this.pepper}:${secret}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return `sha256:${bytesToHex(new Uint8Array(digest))}`;
  }

  async verify(secret: string, hash: string): Promise<boolean> {
    return timingSafeEqualText(await this.hash(secret), hash);
  }
}
