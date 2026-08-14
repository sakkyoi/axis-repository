import { describe, expect, it } from "vitest";
import type { Repository } from "@axis-repository/admin-ui/plugin-ui";
import {
  buildAptGroupSettingsValues,
  buildUpdateAptGroupRepositoryInput,
} from "./group-settings";

describe("APT group settings model", () => {
  it("switches group settings to unsigned without carrying a signing key forward", () => {
    const input = buildUpdateAptGroupRepositoryInput({
      codename: "bookworm",
      components: "main",
      members: ["debian-hosted", "debian-proxy"],
      signingMode: "unsigned",
      signingKeyId: "signing_key_group",
    }, repository());

    expect(input.config?.apt).toEqual({
      codename: "bookworm",
      components: ["main"],
      members: ["debian-hosted", "debian-proxy"],
      signing: { mode: "unsigned" },
    });
  });

  it("switches group settings to Axis signing with a signing key", () => {
    const input = buildUpdateAptGroupRepositoryInput({
      codename: "bookworm",
      components: "",
      members: ["debian-hosted"],
      signingMode: "axis",
      signingKeyId: " signing_key_group ",
    }, repository({ apt: { codename: "bookworm", members: ["debian-hosted"], signing: { mode: "unsigned" } } }));

    expect(input.config?.apt).toEqual({
      codename: "bookworm",
      members: ["debian-hosted"],
      signing: { mode: "axis", signingKeyId: "signing_key_group" },
    });
  });

  it("rejects Axis group signing without a signing key", () => {
    expect(() => buildUpdateAptGroupRepositoryInput({
      codename: "bookworm",
      components: "main",
      members: ["debian-hosted"],
      signingMode: "axis",
      signingKeyId: "",
    }, repository())).toThrow("Signing key is required");
  });

  it("reads existing group signing settings", () => {
    expect(buildAptGroupSettingsValues(repository())).toMatchObject({
      codename: "bookworm",
      components: "main",
      members: ["debian-hosted"],
      signingMode: "axis",
      signingKeyId: "signing_key_group",
    });
    expect(buildAptGroupSettingsValues(repository({
      apt: {
        codename: "bookworm",
        members: ["debian-hosted"],
        signing: { mode: "unsigned" },
      },
    }))).toMatchObject({
      signingMode: "unsigned",
      signingKeyId: "",
    });
  });
});

function repository(config: Record<string, unknown> = {
  apt: {
    codename: "bookworm",
    components: ["main"],
    members: ["debian-hosted"],
    signing: { mode: "axis", signingKeyId: "signing_key_group" },
  },
}): Repository {
  return {
    id: "repo_1",
    name: "debian-group",
    ecosystem: "apt",
    kind: "group",
    visibility: "public",
    config,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}
