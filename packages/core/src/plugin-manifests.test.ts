import { describe, expect, it } from "vitest";
import { aptPluginManifest, pypiPluginManifest } from "./plugin-manifests";

describe("shared plugin manifests", () => {
  it("defines APT metadata once for runtime and admin UI consumers", () => {
    expect(aptPluginManifest).toMatchObject({
      ecosystem: "apt",
      displayName: "APT",
      description: "Debian package repositories with signed Release metadata.",
      runtimeName: "apt-signed",
      version: "0.1.0",
      capabilities: ["apt", "signed-release", "pool-copy", "serve:dists", "serve:pool"],
      repositoryConfig: {
        namespace: "apt",
        fields: [
          {
            name: "codename",
            label: "Codename",
            kind: "text",
            required: true,
            defaultValue: "noble",
          },
          {
            name: "components",
            label: "Components",
            kind: "string-list",
            required: true,
            defaultValue: ["main"],
          },
          {
            name: "architectures",
            label: "Architectures",
            kind: "string-list",
            required: true,
            defaultValue: ["amd64"],
          },
          {
            name: "signingKeyId",
            label: "Signing key",
            kind: "signing-key",
            required: true,
          },
        ],
      },
      clientHelpers: {
        namespace: "apt",
        actions: [
          {
            name: "key.gpg",
            label: "key.gpg",
            responseKind: "text",
            defaultOpen: false,
            public: true,
          },
          {
            name: "source",
            label: "source",
            responseKind: "json",
            defaultOpen: false,
            public: true,
          },
          {
            name: "install",
            label: "install",
            responseKind: "shell",
            defaultOpen: true,
            public: true,
          },
        ],
      },
    });
  });

  it("defines PyPI metadata once for runtime and admin UI consumers", () => {
    expect(pypiPluginManifest).toMatchObject({
      ecosystem: "pypi",
      displayName: "PyPI",
      description: "Python package repositories using the Simple Repository API.",
      runtimeName: "pypi-simple",
      version: "0.1.0",
      capabilities: ["pypi", "simple-api", "serve:simple", "client-helpers"],
      repositoryConfig: {
        namespace: "pypi",
        fields: [],
      },
      clientHelpers: {
        namespace: "pypi",
        actions: [
          {
            name: "simple-url",
            label: "Simple API URL",
            responseKind: "text",
            defaultOpen: true,
            public: true,
            displayPath: "simpleUrl",
          },
        ],
      },
    });
  });
});
