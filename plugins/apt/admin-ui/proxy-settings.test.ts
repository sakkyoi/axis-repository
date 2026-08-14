import { describe, expect, it } from "vitest";
import type { Repository } from "@axis-repository/admin-ui/plugin-ui";
import {
  buildAptProxySettingsValues,
  buildUpdateAptProxyRepositoryInput,
} from "./proxy-settings";

describe("APT proxy settings model", () => {
  it("keeps upstream signing scoped to upstream key URLs", () => {
    const input = buildUpdateAptProxyRepositoryInput({
      signingMode: "upstream",
      upstreamKeyUrl: " https://download.docker.com/linux/debian/gpg ",
      signingKeyId: "signing_key_axis",
    }, repository({
      apt: {
        upstreamUrl: "https://download.docker.com/linux/debian/",
        codename: "bookworm",
        components: ["stable"],
        signing: { mode: "axis", signingKeyId: "signing_key_axis" },
      },
    }));

    expect(input).toEqual({
      visibility: "public",
      config: {
        apt: {
          upstreamUrl: "https://download.docker.com/linux/debian/",
          codename: "bookworm",
          components: ["stable"],
          signing: {
            mode: "upstream",
            upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg",
          },
        },
      },
    });
  });

  it("switches to Axis signing with a repository signing key", () => {
    const input = buildUpdateAptProxyRepositoryInput({
      signingMode: "axis",
      upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg",
      signingKeyId: " signing_key_axis ",
    }, repository({
      apt: {
        upstreamUrl: "https://download.docker.com/linux/debian/",
        codename: "bookworm",
        signing: { mode: "upstream", upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg" },
      },
    }));

    expect(input.config?.apt).toMatchObject({
      upstreamUrl: "https://download.docker.com/linux/debian/",
      codename: "bookworm",
      signing: { mode: "axis", signingKeyId: "signing_key_axis" },
    });
  });

  it("rejects Axis signing without an Axis signing key", () => {
    expect(() => buildUpdateAptProxyRepositoryInput({
      signingMode: "axis",
      upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg",
      signingKeyId: "",
    }, repository())).toThrow("Signing key is required");
  });

  it("switches to unsigned without carrying key fields forward", () => {
    const input = buildUpdateAptProxyRepositoryInput({
      signingMode: "unsigned",
      upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg",
      signingKeyId: "signing_key_axis",
    }, repository({
      apt: {
        upstreamUrl: "https://download.docker.com/linux/debian/",
        codename: "bookworm",
        signing: { mode: "axis", signingKeyId: "signing_key_axis" },
      },
    }));

    expect(input.config?.apt).toMatchObject({
      upstreamUrl: "https://download.docker.com/linux/debian/",
      codename: "bookworm",
      signing: { mode: "unsigned" },
    });
  });

  it("reads existing proxy signing values for the settings form", () => {
    expect(buildAptProxySettingsValues(repository({
      apt: {
        signing: {
          mode: "upstream",
          upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg",
        },
      },
    }))).toEqual({
      signingMode: "upstream",
      upstreamKeyUrl: "https://download.docker.com/linux/debian/gpg",
      signingKeyId: "",
    });
  });
});

function repository(config: Record<string, unknown> = { apt: { signing: { mode: "upstream" } } }): Repository {
  return {
    id: "repo_1",
    name: "debian-proxy",
    ecosystem: "apt",
    kind: "proxy",
    visibility: "public",
    config,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}
