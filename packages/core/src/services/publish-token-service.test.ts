import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  MemoryStateStore,
  NotFoundError,
  PublishTokenService,
  UnauthorizedError,
  ValidationError,
  type Clock,
  type PublishTokenRecord,
  type RandomId,
  type SecretHasher,
} from "../index";

const clock: Clock = {
  now: () => new Date("2026-07-13T00:00:00.000Z"),
};

const randomId: RandomId = {
  create: (prefix: string) => `${prefix}_fixed`,
};

function sequenceRandomId(values: string[]): RandomId {
  let index = 0;
  return {
    create: (prefix: string) => values[index++] ?? `${prefix}_${index}`,
  };
}

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

  it("creates tokens with IAM-ready owner principals", async () => {
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
      owner: {
        type: "admin-user",
        subject: "admin_user_1",
        displayName: "admin",
      },
    });

    expect(result.record.owner).toEqual({
      type: "admin-user",
      subject: "admin_user_1",
      displayName: "admin",
    });
    await expect(service.verify(result.secret)).resolves.toMatchObject({
      owner: {
        type: "admin-user",
        subject: "admin_user_1",
        displayName: "admin",
      },
    });
  });

  it("does not let returned owner principals mutate stored publish tokens", async () => {
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
      owner: {
        type: "admin-user",
        subject: "admin_user_1",
        displayName: "admin",
      },
    });

    result.record.owner!.displayName = "changed";
    const principal = await service.verify(result.secret);
    principal.owner!.displayName = "changed-again";

    await expect(service.getByName("github-actions")).resolves.toMatchObject({
      owner: {
        type: "admin-user",
        subject: "admin_user_1",
        displayName: "admin",
      },
    });
    await expect(service.verify(result.secret)).resolves.toMatchObject({
      owner: {
        displayName: "admin",
      },
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

  it("gets publish tokens by name", async () => {
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

    await expect(service.getByName("github-actions")).resolves.toEqual(result.record);
  });

  it("returns not found for missing publish token detail", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    await expect(service.getByName("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("revokes publish tokens idempotently", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });
    await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });

    const revoked = await service.revoke("github-actions");
    const revokedAgain = await service.revoke("github-actions");

    expect(revoked.revokedAt).toBe("2026-07-13T00:00:00.000Z");
    expect(revokedAgain.revokedAt).toBe(revoked.revokedAt);
  });

  it("returns not found when revoking missing publish tokens", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });

    await expect(service.revoke("missing")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rotates publish token secrets without changing token scope", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId: sequenceRandomId(["ptok_initial", "tok_initial", "tok_rotated"]),
      hasher,
    });
    const result = await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
      expiresAt: "2026-07-14T00:00:00.000Z",
    });

    const rotated = await service.rotate("github-actions");

    expect(rotated.secret).toBe("axis_publish_tok_rotated");
    expect(rotated.record).toMatchObject({
      id: result.record.id,
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: { apt: { allowedPackages: ["myapp"] } },
      signingKeyIds: ["signing_key_prod"],
      expiresAt: "2026-07-14T00:00:00.000Z",
      rotatedAt: "2026-07-13T00:00:00.000Z",
    });
    await expect(service.verify(result.secret)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.verify(rotated.secret)).resolves.toMatchObject({
      name: "github-actions",
      signingKeyIds: ["signing_key_prod"],
    });
  });

  it("does not rotate revoked publish tokens", async () => {
    const service = new PublishTokenService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      hasher,
    });
    await service.create({
      name: "github-actions",
      repositories: ["debian-internal"],
      permissions: ["publish"],
      ecosystemScopes: {},
    });
    await service.revoke("github-actions");

    await expect(service.rotate("github-actions")).rejects.toThrow("Publish token has been revoked");
  });

  it("deletes publish tokens", async () => {
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

    await expect(service.delete("github-actions")).resolves.toBeUndefined();
    await expect(service.getByName("github-actions")).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.verify(result.secret)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
