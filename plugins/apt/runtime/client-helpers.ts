import { pluginJsonResponse } from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { ValidationError, type Repository } from "@axis-repository/core";
import type {
  RepositoryClientHelpers,
  RepositorySigningKeyCapability,
} from "@axis-repository/runtime-cloudflare/plugin-runtime";
import { aptPluginManifest } from "../manifest";
import {
  buildAptInstallInfo,
  buildAptSourceInfo,
  keyringPathForRepository,
  sourceListPathForRepository,
  type AptClientRepositoryInfo,
} from "./client";
import { parseAptGroupRepositoryConfig, parseAptProxyRepositoryConfig } from "./config";
import { parseAptRepositoryConfig } from "./metadata";

function aptClientRepositoryInfo(repository: Repository): AptClientRepositoryInfo {
  const config = parseAptRepositoryConfig(repository);
  return {
    name: repository.name,
    visibility: repository.visibility,
    codename: config.codename,
    suites: config.suites ?? [config.codename],
    components: config.components ?? ["main"],
    signed: config.signing.mode === "axis",
  };
}

function repositoryCacheControl(repository: Repository): string {
  return repository.visibility === "public" ? "public, max-age=300" : "private, no-store";
}

function aptPublicKeyResponse(publicKeyArmored: string, repository: Repository): Response {
  const headers = new Headers();
  headers.set("content-type", "application/pgp-keys");
  headers.set("cache-control", repositoryCacheControl(repository));
  return new Response(publicKeyArmored, { headers });
}

function aptClientHelperAction(name: string) {
  const action = aptPluginManifest.clientHelpers.actions.find((candidate) => candidate.name === name);
  if (!action) {
    throw new Error(`APT client helper manifest is not configured: ${name}`);
  }
  return { ...action };
}

export function createAptClientHelpers(input: {
  signingKeys: RepositorySigningKeyCapability;
}): RepositoryClientHelpers {
  return {
    namespace: aptPluginManifest.clientHelpers.namespace,
    actions: [
      {
        ...aptClientHelperAction("key.gpg"),
        handle: async ({ repository }) => {
          const config = parseAptRepositoryConfig(repository);
          if (config.signing.mode !== "axis") {
            throw new ValidationError("config.apt.signing.mode must be axis to serve key.gpg");
          }
          const key = await input.signingKeys.getPublicKey(config.signing.signingKeyId);
          return aptPublicKeyResponse(key.publicKeyArmored, repository);
        },
      },
      {
        ...aptClientHelperAction("source"),
        handle: async ({ repository, origin }) =>
          pluginJsonResponse(buildAptSourceInfo({ origin, repository: aptClientRepositoryInfo(repository) })),
      },
      {
        ...aptClientHelperAction("install"),
        handle: async ({ repository, origin }) =>
          pluginJsonResponse(buildAptInstallInfo({ origin, repository: aptClientRepositoryInfo(repository) })),
      },
    ],
  };
}

type FetchLike = (request: Request) => Promise<Response>;

export function createAptProxyClientHelpers(input: {
  fetch?: FetchLike;
  signingKeys?: RepositorySigningKeyCapability;
} = {}): RepositoryClientHelpers {
  const fetchImpl = input.fetch ?? ((request: Request) => fetch(request));
  return {
    namespace: aptPluginManifest.clientHelpers.namespace,
    actions: [
      {
        ...aptClientHelperAction("key.gpg"),
        handle: async ({ repository }) => {
          const config = parseAptProxyRepositoryConfig(repository.config);
          if (config.signing.mode === "axis") {
            if (!input.signingKeys) {
              throw new ValidationError("APT proxy axis signing keys are not configured");
            }
            const key = await input.signingKeys.getPublicKey(config.signing.signingKeyId);
            return aptPublicKeyResponse(key.publicKeyArmored, repository);
          }
          if (config.signing.mode !== "upstream" || !config.signing.upstreamKeyUrl) {
            throw new ValidationError("config.apt.signing.upstreamKeyUrl is required to serve key.gpg for upstream-signed proxy repositories");
          }
          const upstream = await fetchImpl(new Request(config.signing.upstreamKeyUrl, { headers: { accept: "application/pgp-keys,*/*" } }));
          if (!upstream.ok) {
            throw new ValidationError(`config.apt.signing.upstreamKeyUrl could not be fetched: upstream returned ${upstream.status}`);
          }
          const headers = new Headers();
          headers.set("content-type", upstream.headers.get("content-type") ?? "application/pgp-keys");
          headers.set("cache-control", repositoryCacheControl(repository));
          return new Response(upstream.body, { headers });
        },
      },
      {
        ...aptClientHelperAction("source"),
        handle: async ({ repository, origin }) =>
          pluginJsonResponse(buildAptProxySourceInfo({ origin, repository })),
      },
      {
        ...aptClientHelperAction("install"),
        handle: async ({ repository, origin }) =>
          pluginJsonResponse(buildAptProxyInstallInfo({ origin, repository })),
      },
    ],
  };
}

export function createAptGroupClientHelpers(input: {
  signingKeys: RepositorySigningKeyCapability;
}): RepositoryClientHelpers {
  return {
    namespace: aptPluginManifest.clientHelpers.namespace,
    actions: [
      {
        ...aptClientHelperAction("key.gpg"),
        handle: async ({ repository }) => {
          const config = parseAptGroupRepositoryConfig(repository.config);
          if (config.signing.mode !== "axis") {
            throw new ValidationError("config.apt.signing.mode must be axis to serve key.gpg");
          }
          const key = await input.signingKeys.getPublicKey(config.signing.signingKeyId);
          return aptPublicKeyResponse(key.publicKeyArmored, repository);
        },
      },
      {
        ...aptClientHelperAction("source"),
        handle: async ({ repository, origin }) =>
          pluginJsonResponse(buildAptGroupSourceInfo({ origin, repository })),
      },
      {
        ...aptClientHelperAction("install"),
        handle: async ({ repository, origin }) =>
          pluginJsonResponse(buildAptGroupInstallInfo({ origin, repository })),
      },
    ],
  };
}

function buildAptGroupSourceInfo(input: {
  origin: string;
  repository: Repository;
}) {
  const config = parseAptGroupRepositoryConfig(input.repository.config);
  return buildAptSourceInfo({
    origin: input.origin,
    repository: {
      name: input.repository.name,
      visibility: input.repository.visibility,
      codename: config.codename,
      suites: [config.codename],
      components: config.components ?? ["main"],
      signed: config.signing.mode === "axis",
    },
  });
}

function buildAptGroupInstallInfo(input: {
  origin: string;
  repository: Repository;
}) {
  const config = parseAptGroupRepositoryConfig(input.repository.config);
  return buildAptInstallInfo({
    origin: input.origin,
    repository: {
      name: input.repository.name,
      visibility: input.repository.visibility,
      codename: config.codename,
      suites: [config.codename],
      components: config.components ?? ["main"],
      signed: config.signing.mode === "axis",
    },
  });
}

function buildAptProxySourceInfo(input: {
  origin: string;
  repository: Repository;
}): Record<string, unknown> {
  const config = parseAptProxyRepositoryConfig(input.repository.config);
  const baseUrl = `${input.origin.replace(/\/+$/g, "")}/repositories/${input.repository.name}`;
  const components = config.components ?? ["main"];
  const keyringPath = config.signing.mode === "axis" || (config.signing.mode === "upstream" && config.signing.upstreamKeyUrl)
    ? keyringPathForRepository(input.repository.name)
    : undefined;
  const sourceOptions = keyringPath ? ` [signed-by=${keyringPath}]` : config.signing.mode === "unsigned" ? " [trusted=yes]" : "";
  const sourceLine = `deb${sourceOptions} ${baseUrl} ${config.codename} ${components.join(" ")}`;
  return {
    repository: input.repository.name,
    ecosystem: "apt",
    baseUrl,
    codename: config.codename,
    suites: [config.codename],
    components,
    ...(keyringPath ? { keyringPath } : {}),
    sourceLine,
    sourceLines: [sourceLine],
    sourcePackageLines: [`deb-src${sourceOptions} ${baseUrl} ${config.codename} ${components.join(" ")}`],
  };
}

function buildAptProxyInstallInfo(input: {
  origin: string;
  repository: Repository;
}): Record<string, unknown> {
  const source = buildAptProxySourceInfo(input);
  const sourceListPath = `/etc/apt/sources.list.d/axis-${input.repository.name}.list`;
  const keyUrl = source.keyringPath ? `${source.baseUrl}/apt/key.gpg` : undefined;
  const keyCommand = keyUrl && typeof source.keyringPath === "string"
    ? `curl -fsSL ${keyUrl} | sudo gpg --dearmor -o ${source.keyringPath}`
    : undefined;
  const commands = [
    ...(keyCommand ? [keyCommand] : []),
    `echo '${source.sourceLine}' | sudo tee ${sourceListPath}`,
    "sudo apt update",
  ];
  if (input.repository.visibility === "private") {
    const authConfPath = `/etc/apt/auth.conf.d/axis-${input.repository.name}.conf`;
    const authConfTemplate = `machine ${new URL(input.origin).host}\nlogin axis\npassword <READ_TOKEN>\n`;
    return {
      ...source,
      visibility: input.repository.visibility,
      sourceListPath,
      authConfPath,
      authConfTemplate,
      ...(keyUrl ? { keyUrl } : {}),
      ...(source.keyringPath ? { keyringPath: source.keyringPath } : {}),
      commands: [
        `sudo tee ${authConfPath} <<'EOF'\n${authConfTemplate.trimEnd()}\nEOF`,
        ...commands,
      ],
      script: [
        "# Configure credentials for private repository access.",
        `sudo tee ${authConfPath} <<'EOF'`,
        authConfTemplate.trimEnd(),
        "EOF",
        "",
        ...(keyCommand
          ? [
            "# Install the repository signing key.",
            keyCommand,
            "",
          ]
          : []),
        "# Configure APT to use this repository.",
        `echo '${source.sourceLine}' | sudo tee ${sourceListPath}`,
        "",
        "# Refresh package indexes.",
        "sudo apt update",
      ].join("\n"),
    };
  }
  return {
    ...source,
    visibility: input.repository.visibility,
    sourceListPath,
    ...(keyUrl ? { keyUrl } : {}),
    ...(source.keyringPath ? { keyringPath: source.keyringPath } : {}),
    commands,
    script: [
      ...(keyCommand
        ? [
          "# Install the repository signing key.",
          keyCommand,
          "",
        ]
        : []),
      "# Configure APT to use this repository.",
      `echo '${source.sourceLine}' | sudo tee ${sourceListPath}`,
      "",
      "# Refresh package indexes.",
      "sudo apt update",
    ].join("\n"),
  };
}
