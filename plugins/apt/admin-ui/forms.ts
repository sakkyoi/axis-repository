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
  signingKeyId: string;
}

const aptRepositoryFormSchema = z.object({
  name: z.string().trim().min(1, "Repository name is required"),
  visibility: z.enum(["private", "public"]),
  codename: z.string().trim().min(1, "Codename is required"),
  components: z.string().trim().min(1, "Components are required"),
  architectures: z.string().trim().min(1, "Architectures are required"),
  signingKeyId: z.string().trim().min(1, "Signing key is required"),
});

function parseForm(values: AptRepositoryFormValues): z.infer<typeof aptRepositoryFormSchema> {
  const result = aptRepositoryFormSchema.safeParse(values);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Repository form is invalid");
  }
  return result.data;
}

function parseList(value: string, label: string): string[] {
  const items = value
    .split(/[\s,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(`${label} are required`);
  }
  return items;
}

function aptConfig(values: AptRepositoryFormValues): Record<string, unknown> {
  const parsed = parseForm(values);
  return {
    apt: {
      codename: parsed.codename,
      components: parseList(parsed.components, "Components"),
      architectures: parseList(parsed.architectures, "Architectures"),
      signingKeyId: parsed.signingKeyId,
    },
  };
}

export function buildCreateAptRepositoryInput(values: AptRepositoryFormValues): CreateRepositoryInput {
  const parsed = parseForm(values);
  return {
    name: parsed.name,
    ecosystem: "apt",
    visibility: parsed.visibility,
    config: aptConfig(values),
  };
}

export function buildUpdateAptRepositoryInput(values: AptRepositoryFormValues): UpdateRepositoryInput {
  const parsed = parseForm(values);
  return {
    visibility: parsed.visibility,
    config: aptConfig(values),
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
  };
}

export function activeSigningKeys(keys: SigningKey[]): SigningKey[] {
  return keys.filter((key) => !key.revokedAt);
}
