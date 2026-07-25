import { z } from "zod";
import type {
  CreateRepositoryInput,
  Repository,
  RepositoryVisibility,
  SigningKey,
  UpdateRepositoryInput,
} from "@axis-repository/admin-ui/plugin-ui";

export interface AptRepositoryFormValues {
  name: string;
  visibility: RepositoryVisibility;
  codename: string;
  components: string;
  architectures: string;
  signingKeyId?: string;
  signingKeyMode?: string;
  signingKeyName?: string;
  signingKeyUserIdName?: string;
  signingKeyUserIdEmail?: string;
  signingKeyPrivateKeyArmored?: string;
  signingKeyPassphrase?: string;
  signingKeyExistingId?: string;
}

const aptRepositoryBaseFormSchema = z.object({
  name: z.string().trim().min(1, "Repository name is required"),
  visibility: z.enum(["private", "public"]),
  codename: z.string().trim().min(1, "Codename is required"),
  components: z.string().trim(),
  architectures: z.string().trim(),
});

const aptRepositoryUpdateFormSchema = aptRepositoryBaseFormSchema.extend({
  signingKeyId: z.string().trim().min(1, "Signing key is required"),
});

function parseBaseForm(values: AptRepositoryFormValues): z.infer<typeof aptRepositoryBaseFormSchema> {
  const result = aptRepositoryBaseFormSchema.safeParse(values);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Repository form is invalid");
  }
  return result.data;
}

function parseUpdateForm(values: AptRepositoryFormValues): z.infer<typeof aptRepositoryUpdateFormSchema> {
  const result = aptRepositoryUpdateFormSchema.safeParse(values);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Repository form is invalid");
  }
  return result.data;
}

function aptConfig(values: AptRepositoryFormValues, signingKeyId?: string): Record<string, unknown> {
  const parsed = parseBaseForm(values);
  const components = parseOptionalList(parsed.components);
  const architectures = parseOptionalList(parsed.architectures);
  return {
    apt: {
      codename: parsed.codename,
      ...(components.length > 0 ? { components } : {}),
      ...(architectures.length > 0 ? { architectures } : {}),
      ...(signingKeyId ? { signingKeyId } : {}),
    },
  };
}

function parseOptionalList(value: string): string[] {
  return value
    .split(/[\s,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildCreateAptRepositoryInput(values: AptRepositoryFormValues): CreateRepositoryInput {
  const parsed = parseBaseForm(values);
  return {
    name: parsed.name,
    ecosystem: "apt",
    visibility: parsed.visibility,
    config: aptConfig(values),
    provisioning: {
      apt: {
        signingKey: signingKeyProvisioning(values),
      },
    },
  };
}

export function buildUpdateAptRepositoryInput(values: AptRepositoryFormValues): UpdateRepositoryInput {
  const parsed = parseUpdateForm(values);
  return {
    visibility: parsed.visibility,
    config: aptConfig(values, parsed.signingKeyId),
  };
}

export function buildAptRepositoryFormValues(repository: Repository): AptRepositoryFormValues {
  const apt = repository.config.apt && typeof repository.config.apt === "object"
    ? repository.config.apt as Record<string, unknown>
    : {};
  return {
    name: repository.name,
    visibility: repository.visibility,
    codename: typeof apt.codename === "string" ? apt.codename : "",
    components: Array.isArray(apt.components) ? apt.components.join(" ") : "",
    architectures: Array.isArray(apt.architectures) ? apt.architectures.join(" ") : "",
    signingKeyId: typeof apt.signingKeyId === "string" ? apt.signingKeyId : "",
    signingKeyMode: "existing",
    signingKeyName: "",
    signingKeyUserIdName: "",
    signingKeyUserIdEmail: "",
    signingKeyPrivateKeyArmored: "",
    signingKeyPassphrase: "",
    signingKeyExistingId: typeof apt.signingKeyId === "string" ? apt.signingKeyId : "",
  };
}

export function activeSigningKeys(keys: SigningKey[]): SigningKey[] {
  return keys.filter((key) => !key.revokedAt);
}

function signingKeyProvisioning(values: AptRepositoryFormValues): Record<string, string> {
  const mode = values.signingKeyMode || "generate";
  if (mode === "existing") {
    const signingKeyId = values.signingKeyExistingId?.trim();
    if (!signingKeyId) throw new Error("Signing key is required");
    return { mode, signingKeyId };
  }
  const name = values.signingKeyName?.trim();
  if (!name) throw new Error("Signing key name is required");
  if (mode === "import") {
    const privateKeyArmored = values.signingKeyPrivateKeyArmored?.trim();
    const passphrase = values.signingKeyPassphrase ?? "";
    if (!privateKeyArmored) throw new Error("Signing key private key is required");
    if (!passphrase) throw new Error("Signing key passphrase is required");
    return { mode, name, privateKeyArmored, passphrase };
  }
  const userIdName = values.signingKeyUserIdName?.trim();
  const userIdEmail = values.signingKeyUserIdEmail?.trim();
  if (!userIdName) throw new Error("Signing key user ID name is required");
  if (!userIdEmail) throw new Error("Signing key user ID email is required");
  return { mode: "generate", name, userIdName, userIdEmail };
}
