import type { Repository, UpdateRepositoryInput } from "@axis-repository/admin-ui/plugin-ui";

export interface AptGroupSettingsValues {
  codename: string;
  components: string;
  members: string[];
  signingMode: "axis" | "unsigned";
  signingKeyId: string;
}

export function buildAptGroupSettingsValues(repository: Repository): AptGroupSettingsValues {
  const config = aptConfig(repository);
  const components = config.components;
  const signing = aptSigning(config);
  return {
    codename: typeof config.codename === "string" ? config.codename : "",
    components: Array.isArray(components) ? components.filter((component): component is string => typeof component === "string").join(" ") : "",
    members: aptGroupMembers(config),
    signingMode: signing.mode === "unsigned" ? "unsigned" : "axis",
    signingKeyId: signing.mode === "axis" && typeof signing.signingKeyId === "string" ? signing.signingKeyId : "",
  };
}

export function buildUpdateAptGroupRepositoryInput(
  values: AptGroupSettingsValues,
  repository: Repository,
): UpdateRepositoryInput {
  const apt: Record<string, unknown> = {
    ...aptConfig(repository),
    codename: values.codename.trim(),
    members: [...new Set(values.members.map((member) => member.trim()).filter(Boolean))],
  };
  const components = aptGroupComponents(values.components);
  if (components.length > 0) {
    apt.components = components;
  } else {
    delete apt.components;
  }
  if (values.signingMode === "unsigned") {
    apt.signing = { mode: "unsigned" };
  } else {
    const signingKeyId = values.signingKeyId.trim();
    if (!signingKeyId) {
      throw new Error("Signing key is required");
    }
    apt.signing = { mode: "axis", signingKeyId };
  }
  return {
    visibility: repository.visibility,
    config: {
      ...repository.config,
      apt,
    },
  };
}

export function shouldLoadAptGroupSigningKeys(values: AptGroupSettingsValues): boolean {
  return values.signingMode === "axis";
}

function aptConfig(repository: Repository): Record<string, unknown> {
  const apt = repository.config.apt;
  return apt && typeof apt === "object" && !Array.isArray(apt) ? apt as Record<string, unknown> : {};
}

function aptSigning(config: Record<string, unknown>): Record<string, unknown> {
  const signing = config.signing;
  return signing && typeof signing === "object" && !Array.isArray(signing) ? signing as Record<string, unknown> : {};
}

function aptGroupMembers(config: Record<string, unknown>): string[] {
  const members = config.members;
  return Array.isArray(members) ? members.filter((member): member is string => typeof member === "string") : [];
}

function aptGroupComponents(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/u).map((component) => component.trim()).filter(Boolean))];
}
