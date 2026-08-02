import type { RepositoryPluginManifest } from "@axis-repository/core/plugin-manifests";
import { debianOpenLogoNoTextSvg } from "./assets/debian-openlogo-nd";

export const aptPluginManifest = {
  ecosystem: "apt",
  displayName: "APT",
  description: "Debian package repositories with signed Release metadata.",
  runtimeName: "apt-signed",
  version: "0.1.0",
  capabilities: ["apt", "signed-release", "pool-copy", "serve:dists", "serve:pool"],
  icon: {
    title: "APT",
    accentColor: "#A80030",
    svg: debianOpenLogoNoTextSvg,
    svgSource: {
      name: "Debian Open Use Logo without Debian label",
      url: "https://www.debian.org/logos/openlogo-nd.svg",
      rights: "LGPL-3.0-or-later OR CC-BY-SA-3.0",
    },
  },
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
        // Asked for up front because it decides the directory layout. Adding a
        // suite later is safe, but removing one strands its whole dists tree:
        // nothing writes to it again and nothing renews its Release, while a
        // client still pointed at it keeps taking signed but frozen metadata.
        name: "suites",
        label: "Suites",
        kind: "string-list",
        step: "config",
        required: false,
        placeholder: "leave empty for just the codename",
        description: "Every suite this repository publishes, space separated. Must include the codename.",
      },
      {
        name: "signingKey",
        label: "Signing key",
        kind: "signing-key-provisioning",
        step: "setup",
        required: true,
        description: "OpenPGP key to generate, import, or attach while creating this repository.",
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
