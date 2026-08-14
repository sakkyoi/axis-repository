import type {
  Repository,
  UpdateRepositoryInput,
} from "@axis-repository/admin-ui/plugin-ui";

export type AptProxySigningMode = "upstream" | "axis" | "unsigned";

export interface AptProxySettingsValues {
  signingMode: AptProxySigningMode;
  upstreamKeyUrl: string;
  signingKeyId: string;
}

export function buildAptProxySettingsValues(repository: Repository): AptProxySettingsValues {
  const signing = aptProxySigning(repository);
  return {
    signingMode: aptProxySigningMode(signing),
    upstreamKeyUrl: typeof signing.upstreamKeyUrl === "string" ? signing.upstreamKeyUrl : "",
    signingKeyId: typeof signing.signingKeyId === "string" ? signing.signingKeyId : "",
  };
}

export function buildUpdateAptProxyRepositoryInput(
  values: AptProxySettingsValues,
  repository: Repository,
): UpdateRepositoryInput {
  return {
    visibility: repository.visibility,
    config: {
      ...repository.config,
      apt: {
        ...aptConfigOf(repository),
        signing: aptProxySigningConfig(values),
      },
    },
  };
}

export function aptProxyConfigString(repository: Repository, field: string): string {
  const value = aptConfigOf(repository)[field];
  return typeof value === "string" ? value : "";
}

export function aptProxySigningPolicyLabel(repository: Repository): string {
  const signing = aptProxySigning(repository);
  if (signing.mode === "axis") return "Re-sign with Axis";
  if (signing.mode === "unsigned") return "Unsigned";
  return "Use upstream";
}

export function aptProxyUpstreamKeyUrl(repository: Repository): string {
  const value = aptProxySigning(repository).upstreamKeyUrl;
  return typeof value === "string" ? value : "";
}

export function aptProxyAxisSigningKeyId(repository: Repository): string {
  const value = aptProxySigning(repository).signingKeyId;
  return typeof value === "string" ? value : "";
}

function aptProxySigningConfig(values: AptProxySettingsValues): Record<string, unknown> {
  if (values.signingMode === "axis") {
    const signingKeyId = values.signingKeyId.trim();
    if (!signingKeyId) {
      throw new Error("Signing key is required");
    }
    return { mode: "axis", signingKeyId };
  }
  if (values.signingMode === "unsigned") {
    return { mode: "unsigned" };
  }
  const upstreamKeyUrl = values.upstreamKeyUrl.trim();
  return {
    mode: "upstream",
    ...(upstreamKeyUrl ? { upstreamKeyUrl } : {}),
  };
}

function aptConfigOf(repository: Repository): Record<string, unknown> {
  const apt = repository.config.apt;
  return apt && typeof apt === "object" && !Array.isArray(apt)
    ? apt as Record<string, unknown>
    : {};
}

function aptProxySigning(repository: Repository): Record<string, unknown> {
  const signing = aptConfigOf(repository).signing;
  return signing && typeof signing === "object" && !Array.isArray(signing)
    ? signing as Record<string, unknown>
    : {};
}

function aptProxySigningMode(signing: Record<string, unknown>): AptProxySigningMode {
  if (signing.mode === "axis") return "axis";
  if (signing.mode === "unsigned") return "unsigned";
  return "upstream";
}
