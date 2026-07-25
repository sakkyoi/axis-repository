import { describe, expect, it } from "vitest";
import { revokeAptSigningKeyDialogContent } from "./signing-keys-model";

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
});
