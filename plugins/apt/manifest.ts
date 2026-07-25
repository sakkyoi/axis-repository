import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";

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
} satisfies RepositoryPluginManifest;
