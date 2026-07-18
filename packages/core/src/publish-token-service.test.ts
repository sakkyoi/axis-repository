import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  MemoryStateStore,
  PublishTokenService,
  UnauthorizedError,
  ValidationError,
  type Clock,
  type PublishTokenRecord,
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
      signingKeyIds: [],
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

  it("treats persisted tokens without signing key scopes as unscoped", async () => {
    const state = new MemoryStateStore();
    await state.publishTokens.save({
      id: "ptok_legacy",
      name: "legacy-actions",
      tokenHash: "hash:axis_publish_legacy",
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      createdAt: "2026-07-13T00:00:00.000Z",
    } as PublishTokenRecord);
    const service = new PublishTokenService({
      state,
      clock,
      randomId,
      hasher,
    });

    await expect(service.list()).resolves.toMatchObject([
      { name: "legacy-actions", signingKeyIds: [] },
    ]);
    await expect(service.verify("axis_publish_legacy")).resolves.toMatchObject({
      signingKeyIds: [],
    });
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

  it("creates and verifies publish tokens with signing key scopes", async () => {
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
      signingKeyIds: ["signing_key_prod"],
    });

    expect(result.record.signingKeyIds).toEqual(["signing_key_prod"]);
    await expect(service.verify(result.secret)).resolves.toMatchObject({
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("defaults publish token signing key scopes to empty", async () => {
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

    expect(result.record.signingKeyIds).toEqual([]);
    await expect(service.verify(result.secret)).resolves.toMatchObject({
      signingKeyIds: [],
    });
  });

  it("does not let verified principals mutate stored signing key scope", async () => {
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
      signingKeyIds: ["signing_key_prod"],
    });

    const principal = await service.verify(result.secret);
    principal.signingKeyIds.push("signing_key_other");

    await expect(service.verify(result.secret)).resolves.toMatchObject({
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("does not let create inputs mutate stored signing key scope", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });
    const signingKeyIds = ["signing_key_prod"];
    const result = await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
      signingKeyIds,
    });

    signingKeyIds.push("signing_key_other");

    await expect(service.verify(result.secret)).resolves.toMatchObject({
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("does not let returned publish token records mutate stored signing key scope", async () => {
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
      signingKeyIds: ["signing_key_prod"],
    });

    result.record.signingKeyIds.push("signing_key_other");

    await expect(service.verify(result.secret)).resolves.toMatchObject({
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("does not let listed publish token records mutate stored signing key scope", async () => {
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
      signingKeyIds: ["signing_key_prod"],
    });

    const records = await service.list();
    records[0]?.signingKeyIds.push("signing_key_other");

    await expect(service.verify(result.secret)).resolves.toMatchObject({
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("creates and verifies read-only tokens with repository scope", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    const result = await service.create({
      name: "apt-reader",
      repositories: ["debian-internal"],
      permissions: ["read"],
      ecosystemScopes: {},
    });

    expect(result.secret).toBe("axis_publish_tok_fixed");
    expect(result.record.permissions).toEqual(["read"]);
    await expect(service.verify(result.secret)).resolves.toMatchObject({
      tokenId: "ptok_fixed",
      name: "apt-reader",
      repositories: ["debian-internal"],
      permissions: ["read"],
    });
  });

  it("creates and verifies tokens with both read and publish permissions", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    const result = await service.create({
      name: "ci-token",
      repositories: ["debian-internal"],
      permissions: ["read", "publish"],
      ecosystemScopes: {},
    });

    await expect(service.verify(result.secret)).resolves.toMatchObject({
      repositories: ["debian-internal"],
      permissions: ["read", "publish"],
    });
  });

  it("rejects tokens without permissions", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    await expect(
      service.create({
        name: "empty",
        repositories: ["debian-internal"],
        permissions: [],
        ecosystemScopes: {},
      }),
    ).rejects.toThrow("Publish token must include at least one permission");
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
