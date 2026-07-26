import { describe, expect, it } from "vitest";
import { MemoryStateStore, PublishTokenService, AdminAuthService, type Clock, type RandomId } from "@axis-repository/core";
import { Sha256SecretHasher, Pbkdf2PasswordHasher, WebCryptoRandomId } from "./crypto";
import { HmacAdminAccessTokenCodec } from "./auth/admin-auth";

const clock: Clock = { now: () => new Date("2026-07-26T00:00:00.000Z") };
const randomId: RandomId = new WebCryptoRandomId();

/**
 * Existing deployments hold data written before the publish token format and
 * the password KDF changed. These exercise the real adapters, not fakes,
 * because the compatibility lives in the adapter implementations.
 */
describe("pre-existing deployment data", () => {
  it("verifies a publish token issued in the old format with the real hasher", async () => {
    const state = new MemoryStateStore();
    const hasher = new Sha256SecretHasher("prod-pepper");
    const service = new PublishTokenService({ state, clock, randomId, hasher });
    // Exactly what create() produced before the id was embedded.
    const legacySecret = "axis_publish_tok_9f2c1ab34de5";
    await state.publishTokens.save({
      id: "ptok_old",
      name: "legacy-ci",
      tokenHash: await hasher.hash(legacySecret),
      permissions: ["publish"],
      repositories: ["debian-internal"],
      ecosystemScopes: {},
      signingKeyIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(service.verify(legacySecret)).resolves.toMatchObject({
      tokenId: "ptok_old",
      name: "legacy-ci",
    });
  });

  it("signs in with an AXIS_ADMIN_PASSWORD_HASH stored in the old sha256 format", async () => {
    const state = new MemoryStateStore();
    const hasher = new Sha256SecretHasher("prod-pepper");
    const passwordHasher = new Pbkdf2PasswordHasher("prod-pepper", 1000);
    const legacyHash = await hasher.hash("operator-password");
    expect(legacyHash).toMatch(/^sha256:/);

    const service = new AdminAuthService({
      state, clock, randomId, hasher, passwordHasher,
      bootstrapOwner: { username: "admin", passwordHash: legacyHash },
      accessTokens: new HmacAdminAccessTokenCodec("session-secret", () => clock.now()),
    });

    const login = await service.login({ username: "admin", password: "operator-password" });
    expect(login.accessToken).toBeTruthy();
    // The stored hash is upgraded to PBKDF2 in place.
    await expect(state.adminUsers.getByUsername("admin")).resolves.toMatchObject({
      passwordHash: expect.stringMatching(/^pbkdf2-sha256\$/),
    });
    // And the access token still verifies against the live session.
    await expect(service.verifyAccessToken(login.accessToken)).resolves.toMatchObject({ username: "admin" });
    // Signing in again with the same password works against the upgraded hash.
    await expect(service.login({ username: "admin", password: "operator-password" }))
      .resolves.toMatchObject({ principal: { username: "admin" } });
  });
});
