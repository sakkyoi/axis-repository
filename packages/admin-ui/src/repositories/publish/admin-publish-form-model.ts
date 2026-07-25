import { sha256 } from "@noble/hashes/sha2.js";

export async function sha256Hex(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))
    : sha256(bytes);
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
