export type AptDigestAlgorithm = "SHA-256" | "SHA-512";

export async function digestHex(algorithm: AptDigestAlgorithm, bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
