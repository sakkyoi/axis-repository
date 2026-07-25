import { describe, expect, it } from "vitest";
import { revokeAptSigningKeyDialogContent, submitAptSigningKeyForm } from "./signing-keys-model";

describe("APT signing keys model", () => {
  it("builds destructive dialog copy for revoking a signing key", () => {
    expect(revokeAptSigningKeyDialogContent("debian-prod")).toEqual({
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
    const formData = new FormData();
    formData.set("name", "release");
    formData.set("userIdName", "Axis Repository");
    formData.set("userIdEmail", "axis@example.test");

    await submitAptSigningKeyForm({
      mode: "generate",
      repositoryName: "debian-prod",
      formData,
      formElement: { reset: () => { resetCount += 1; } },
      generateKey: async (input) => { calls.push(input); },
      importKey: async () => { throw new Error("import should not run"); },
      setError: (message) => { calls.push({ error: message }); },
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
      { error: "" },
    ]);
    expect(resetCount).toBe(1);
  });
});
