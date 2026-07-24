import type { EncryptedSecret } from "@axis-repository/core";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error("Invalid encrypted secret encoding");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export class SecretEncryption {
  private readonly key: Promise<CryptoKey>;

  constructor(private readonly secret: string) {
    if (!secret.trim()) {
      throw new Error("SIGNING_KEY_ENCRYPTION_SECRET is required");
    }
    this.key = this.importKey();
  }

  async encrypt(value: string): Promise<EncryptedSecret> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await this.key,
      textEncoder.encode(value),
    );
    return {
      algorithm: "AES-GCM",
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    };
  }

  async decrypt(value: EncryptedSecret): Promise<string> {
    if (value.algorithm !== "AES-GCM") {
      throw new Error("Unsupported encrypted secret algorithm");
    }
    const iv = base64UrlDecode(value.iv);
    if (iv.byteLength !== 12) {
      throw new Error("Invalid encrypted secret encoding");
    }
    const ciphertext = base64UrlDecode(value.ciphertext);
    if (ciphertext.byteLength === 0) {
      throw new Error("Invalid encrypted secret encoding");
    }
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      await this.key,
      ciphertext,
    );
    return textDecoder.decode(plaintext);
  }

  private async importKey(): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(this.secret));
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
}
