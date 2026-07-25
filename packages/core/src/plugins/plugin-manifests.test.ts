import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aptPluginManifest } from "@axis-repository/plugin-apt/manifest";
import { pypiPluginManifest } from "@axis-repository/plugin-pypi/manifest";

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(srcDir, "..", "..", "..", "..");

describe("shared plugin manifests", () => {
  it("keeps concrete plugin manifests in repo-level plugin directories", () => {
    const coreManifestTypes = readFileSync(join(srcDir, "plugin-manifests.ts"), "utf8");

    expect(coreManifestTypes).not.toContain("aptPluginManifest");
    expect(coreManifestTypes).not.toContain("pypiPluginManifest");
    expect(existsSync(join(repoRoot, "plugins", "apt", "manifest.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "pypi", "manifest.ts"))).toBe(true);
  });

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
            step: "config",
            required: true,
            defaultValue: "noble",
            placeholder: "noble",
            description: "Debian distribution codename used under dists/.",
          },
          {
            name: "signingKeyId",
            label: "Signing key",
            kind: "signing-key",
            step: "dependencies",
            required: true,
            description: "OpenPGP key scoped to this repository name.",
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
      adminResources: {
        namespace: "apt",
        routes: [
          {
            name: "list-signing-keys",
            method: "GET",
            path: ["signing-keys"],
            responseKind: "json",
          },
          {
            name: "import-signing-key",
            method: "POST",
            path: ["signing-keys", "import"],
            responseKind: "json",
          },
          {
            name: "generate-signing-key",
            method: "POST",
            path: ["signing-keys", "generate"],
            responseKind: "json",
          },
          {
            name: "get-signing-key",
            method: "GET",
            path: ["signing-keys", ":id"],
            responseKind: "json",
          },
          {
            name: "revoke-signing-key",
            method: "POST",
            path: ["signing-keys", ":id", "revoke"],
            responseKind: "json",
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
