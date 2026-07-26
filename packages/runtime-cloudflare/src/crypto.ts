import type { PasswordHasher, RandomId, SecretHasher } from "@axis-repository/core";
import { timingSafeEqualText } from "@axis-repository/core";

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

const PBKDF2_PREFIX = "pbkdf2-sha256";
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BITS = 256;

/**
 * Password hashing with a per-user salt and a deliberate work factor.
 *
 * Hashes are stored as `pbkdf2-sha256$<iterations>$<salt>$<derived key>` so the
 * iteration count travels with the hash and can be raised later without
 * invalidating existing passwords.
 *
 * Deployments seeded before this existed hold `sha256:<hex>` digests produced by
 * {@link Sha256SecretHasher}, and `AXIS_ADMIN_PASSWORD_HASH` still accepts that
 * form. Those verify through the legacy path and are reported by
 * {@link needsRehash} so the caller can upgrade them on next sign-in.
 */
export class Pbkdf2PasswordHasher implements PasswordHasher {
  private readonly legacyHasher: Sha256SecretHasher;

  constructor(
    private readonly pepper = "",
    private readonly iterations: number = PBKDF2_ITERATIONS,
  ) {
    this.legacyHasher = new Sha256SecretHasher(pepper);
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
    const derived = await this.deriveKey(password, salt, this.iterations);
    return `${PBKDF2_PREFIX}$${this.iterations}$${bytesToBase64(salt)}$${bytesToBase64(derived)}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    if (!hash.startsWith(`${PBKDF2_PREFIX}$`)) {
      return this.legacyHasher.verify(password, hash);
    }
    const [, iterationsText, saltBase64, expected] = hash.split("$");
    if (!iterationsText || !saltBase64 || !expected) {
      return false;
    }
    const iterations = Number(iterationsText);
    if (!Number.isSafeInteger(iterations) || iterations <= 0) {
      return false;
    }
    let salt: Uint8Array;
    try {
      salt = base64ToBytes(saltBase64);
    } catch {
      return false;
    }
    const derived = await this.deriveKey(password, salt, iterations);
    return timingSafeEqualText(bytesToBase64(derived), expected);
  }

  needsRehash(hash: string): boolean {
    if (!hash.startsWith(`${PBKDF2_PREFIX}$`)) {
      return true;
    }
    const iterations = Number(hash.split("$")[1]);
    return !Number.isSafeInteger(iterations) || iterations < this.iterations;
  }

  private async deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    // The pepper is mixed in as well as the salt, so a copy of stored state
    // without TOKEN_HASH_PEPPER is not offline-crackable. The previous
    // SHA-256 scheme was keyed this way and dropping it would have been a
    // regression hidden inside an improvement.
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(`${this.pepper}:${password}`),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      key,
      PBKDF2_KEY_BITS,
    );
    return new Uint8Array(bits);
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
