import { describe, expect, it } from "vitest";
import { SecretEncryption } from "./secret-encryption";

describe("SecretEncryption", () => {
  it("requires a non-empty encryption secret", () => {
    expect(() => new SecretEncryption("   ")).toThrow(
      "SIGNING_KEY_ENCRYPTION_SECRET is required",
    );
  });

  it("encrypts and decrypts values without storing plaintext", async () => {
    const encryption = new SecretEncryption("local-test-secret");

    const encrypted = await encryption.encrypt("sensitive-value");

    expect(encrypted.algorithm).toBe("AES-GCM");
    expect(encrypted.iv).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encrypted.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encrypted.ciphertext).not.toContain("sensitive-value");
    await expect(encryption.decrypt(encrypted)).resolves.toBe("sensitive-value");
  });

  it("uses a fresh iv for each encryption", async () => {
    const encryption = new SecretEncryption("local-test-secret");

    const first = await encryption.encrypt("same-value");
    const second = await encryption.encrypt("same-value");

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("rejects unsupported encrypted secret algorithms", async () => {
    const encryption = new SecretEncryption("local-test-secret");

    await expect(
      encryption.decrypt({
        algorithm: "AES-CBC" as "AES-GCM",
        iv: "aXY",
        ciphertext: "Y2lwaGVy",
      }),
    ).rejects.toThrow("Unsupported encrypted secret algorithm");
  });

  it("rejects malformed encrypted secret encoding", async () => {
    const encryption = new SecretEncryption("local-test-secret");

    await expect(
      encryption.decrypt({
        algorithm: "AES-GCM",
        iv: "not+base64url",
        ciphertext: "Y2lwaGVy",
      }),
    ).rejects.toThrow("Invalid encrypted secret encoding");
  });

  it("rejects encrypted secrets with invalid iv length", async () => {
    const encryption = new SecretEncryption("local-test-secret");

    await expect(
      encryption.decrypt({
        algorithm: "AES-GCM",
        iv: "aXY",
        ciphertext: "Y2lwaGVy",
      }),
    ).rejects.toThrow("Invalid encrypted secret encoding");
  });

  it("rejects tampered ciphertext", async () => {
    const encryption = new SecretEncryption("local-test-secret");
    const encrypted = await encryption.encrypt("sensitive-value");

    await expect(
      encryption.decrypt({
        ...encrypted,
        ciphertext: `${encrypted.ciphertext.slice(0, -1)}A`,
      }),
    ).rejects.toThrow();
  });
});
