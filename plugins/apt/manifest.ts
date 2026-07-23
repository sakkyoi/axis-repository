import type { RepositoryPluginManifest } from "../../packages/core/src/plugin-manifests";

export const aptPluginManifest = {
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
        name: "components",
        label: "Components",
        kind: "string-list",
        step: "config",
        required: true,
        defaultValue: ["main"],
        placeholder: "main contrib",
        description: "Space or comma separated Debian components.",
      },
      {
        name: "architectures",
        label: "Architectures",
        kind: "string-list",
        step: "config",
        required: true,
        defaultValue: ["amd64"],
        placeholder: "amd64 arm64",
        description: "Space or comma separated Debian architectures.",
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
} satisfies RepositoryPluginManifest;
