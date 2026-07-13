import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  MemoryStateStore,
  PublishTokenService,
  UnauthorizedError,
  ValidationError,
  type Clock,
  type RandomId,
  type SecretHasher,
} from "./index";

const clock: Clock = {
  now: () => new Date("2026-07-13T00:00:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix: string) => `${prefix}_fixed`,
};

const hasher: SecretHasher = {
  hash: async (secret: string) => `hash:${secret}`,
  verify: async (secret: string, hash: string) => hash === `hash:${secret}`,
};

describe("PublishTokenService", () => {
  it("creates a token and verifies the returned secret", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    const result = await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
    });

    expect(result.secret).toBe("axis_publish_tok_fixed");
    expect(result.record.tokenHash).toBe("hash:axis_publish_tok_fixed");
    await expect(service.verify(result.secret)).resolves.toMatchObject({
      tokenId: "ptok_fixed",
      name: "github-actions",
      permissions: ["publish"],
      repositories: ["debian-internal"],
    });
  });

  it("rejects invalid tokens", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    await expect(service.verify("axis_publish_missing")).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects invalid expiresAt values", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    await expect(
      service.create({
        name: "github-actions",
        repositories: ["debian-internal"],
        permissions: ["publish"],
        ecosystemScopes: {},
        expiresAt: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects persisted tokens with invalid expiresAt values", async () => {
    const state = new MemoryStateStore();
    await state.publishTokens.save({
      id: "ptok_corrupt",
      name: "github-actions",
      tokenHash: "hash:axis_publish_corrupt",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      createdAt: "2026-07-13T00:00:00.000Z",
      expiresAt: "not-a-date",
    });
    const service = new PublishTokenService({
      state,
      clock,
      randomId,
      hasher,
    });

    await expect(service.verify("axis_publish_corrupt")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not let verified principals mutate stored token scope", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });
    const result = await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
    });

    const principal = await service.verify(result.secret);
    principal.permissions.push("admin");
    principal.repositories.push("production");
    (principal.ecosystemScopes.apt as { allowedPackages: string[] }).allowedPackages.push("other");

    await expect(service.verify(result.secret)).resolves.toMatchObject({
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
    });
  });

  it("rejects revoked tokens", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });
    const result = await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    await service.revoke("github-actions");

    await expect(service.verify(result.secret)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
