import { describe, expect, it } from "vitest";
import {
  aptSigningKeySettingsState,
  revokeAptSigningKeyDialogContent,
  submitAptSigningKeyForm,
} from "./signing-keys-model";
import type { SigningKey } from "@axis-repository/admin-ui/plugin-ui";

const activeKey: SigningKey = {
  id: "signing_key_active",
  repositoryName: "debian-prod",
  name: "active",
  publicKeyArmored: "public",
  fingerprint: "fingerprint-active",
  keyId: "key-active",
  createdAt: "2026-07-25T00:00:00.000Z",
  revokedAt: null,
};

const revokedKey: SigningKey = {
  ...activeKey,
  id: "signing_key_revoked",
  name: "revoked",
  fingerprint: "fingerprint-revoked",
  keyId: "key-revoked",
  revokedAt: "2026-07-26T00:00:00.000Z",
};

describe("APT signing keys model", () => {
  it("builds destructive dialog copy for revoking a signing key", () => {
    expect(revokeAptSigningKeyDialogContent({
      signingKeyName: "debian-prod",
      isCurrent: false,
      isLastActive: false,
    })).toEqual({
      title: "Revoke APT signing key",
      description: "Revoke debian-prod? Repositories using this key will no longer be able to publish signed metadata with it.",
      confirmLabel: "Revoke key",
      pendingLabel: "Revoking...",
      confirmationText: "debian-prod",
    });
  });

  it("resets the captured signing key form after generating a key", async () => {
    const calls: unknown[] = [];
    let resetCount = 0;
    let closeCount = 0;
    const formData = new FormData();
    formData.set("name", "release");
    formData.set("userIdName", "Axis Repository");
    formData.set("userIdEmail", "axis@example.test");

    await submitAptSigningKeyForm({
      mode: "generate",
      repositoryName: "debian-prod",
      formData,
      formElement: { reset: () => { resetCount += 1; } },
      useAsPrimary: true,
      generateKey: async (input) => {
        calls.push(input);
        return activeKey;
      },
      importKey: async () => { throw new Error("import should not run"); },
      setPrimarySigningKey: async (key) => { calls.push({ primary: key.id }); },
      setError: (message) => { calls.push({ error: message }); },
      close: () => { closeCount += 1; },
    });

    expect(calls).toEqual([
      {
        repositoryName: "debian-prod",
        input: {
          name: "release",
          userIdName: "Axis Repository",
          userIdEmail: "axis@example.test",
        },
      },
      { primary: "signing_key_active" },
      { error: "" },
    ]);
    expect(resetCount).toBe(1);
    expect(closeCount).toBe(1);
  });

  it("keeps revoked signing keys out of selectable settings options", () => {
    expect(aptSigningKeySettingsState({
      signingKeys: [revokedKey, activeKey],
      currentSigningKeyId: "signing_key_revoked",
    })).toEqual({
      activeKeys: [activeKey],
      currentKey: revokedKey,
      currentKeyRevoked: true,
      hasActiveKey: true,
      selectableSigningKeyId: "",
    });
  });

  it("adds revoke warnings for current and last active signing keys", () => {
    expect(revokeAptSigningKeyDialogContent({
      signingKeyName: "active",
      isCurrent: true,
      isLastActive: true,
    }).description).toBe(
      "Revoke active? Repositories using this key will no longer be able to publish signed metadata with it.\n\nThis key is currently used by this repository. Revoking it will disable publishing until another active signing key is selected.\n\nThis is the last active signing key. Revoking it will leave the repository without a usable signing key.",
    );
  });
});
