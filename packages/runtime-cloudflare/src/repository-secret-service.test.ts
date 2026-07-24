import { describe, expect, it } from "vitest";
import { MemoryStateStore, NotFoundError, type Clock, type RandomId } from "@axis-repository/core";
import { SecretEncryption } from "./secret-encryption";
import { RepositorySecretService } from "./repository-secret-service";

const clock: Clock = { now: () => new Date("2026-07-18T00:00:00.000Z") };
const randomId: RandomId = { create: (prefix) => `${prefix}_fixed` };

describe("RepositorySecretService", () => {
  it("stores encrypted repository-scoped secrets behind a generic capability", async () => {
    const state = new MemoryStateStore();
    const service = new RepositorySecretService({
      state,
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    const created = await service.create({
      namespace: "npm.token",
      repositoryName: "npm-prod",
      name: "publish-token",
      publicMetadata: {
        scope: "publish",
        label: "automation",
      },
      secrets: {
        token: "secret-token",
      },
    });

    expect(created).toEqual({
      id: "repository_secret_fixed",
      namespace: "npm.token",
      repositoryName: "npm-prod",
      name: "publish-token",
      publicMetadata: {
        scope: "publish",
        label: "automation",
      },
      createdAt: "2026-07-18T00:00:00.000Z",
      revokedAt: null,
    });
    expect(JSON.stringify(await state.signingKeys.getById("repository_secret_fixed"))).not.toContain("secret-token");
    await expect(service.getActive("repository_secret_fixed")).resolves.toMatchObject({
      secrets: {
        token: "secret-token",
      },
    });
    await expect(service.list({ namespace: "npm.token", repositoryName: "npm-prod" })).resolves.toEqual([
      created,
    ]);
  });

  it("fails closed for missing active secrets", async () => {
    const service = new RepositorySecretService({
      state: new MemoryStateStore(),
      clock,
      randomId,
      encryption: new SecretEncryption("local-test-secret"),
    });

    await expect(service.getActive("missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});
