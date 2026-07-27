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
  suites: string;
  components: string;
  architectures: string;
  origin: string;
  label: string;
  suite: string;
  description: string;
  /** Empty means no `Valid-Until`, so the published metadata never expires. */
  validityDays: string;
  notAutomatic: boolean;
  butAutomaticUpgrades: boolean;
  acquireByHash: boolean;
  signingKeyId?: string;
  signingKeyMode?: string;
  signingKeyName?: string;
  signingKeyUserIdName?: string;
  signingKeyUserIdEmail?: string;
  signingKeyPrivateKeyArmored?: string;
  signingKeyPassphrase?: string;
  signingKeyExistingId?: string;
}

/**
 * The settings a repository starts out without.
 *
 * All of them default to something sensible, so the create wizard asks only
 * for what it cannot guess. Every `Release` field here can be changed at any
 * time without disturbing what is already published — the next write picks it
 * up, and the renewal timer writes one within hours even without a publish.
 *
 * `suites` is the exception. Adding one is safe, but removing one leaves that
 * whole `dists/<suite>/` tree behind: nothing writes to it again, nothing
 * renews its `Release`, and a client still pointed at it keeps taking signed
 * but frozen metadata until `Valid-Until` lapses.
 */
export const emptyAptSettings = {
  suites: "",
  origin: "",
  label: "",
  suite: "",
  description: "",
  validityDays: "",
  notAutomatic: false,
  butAutomaticUpgrades: false,
  acquireByHash: true,
} as const;

const aptRepositoryBaseFormSchema = z.object({
  name: z.string().trim().min(1, "Repository name is required"),
  visibility: z.enum(["private", "public"]),
  codename: z.string().trim().min(1, "Codename is required"),
  suites: z.string().trim(),
  components: z.string().trim(),
  architectures: z.string().trim(),
  origin: z.string().trim(),
  label: z.string().trim(),
  suite: z.string().trim(),
  description: z.string().trim(),
  validityDays: z.string().trim().refine(
    (value) => value === "" || (/^\d+$/.test(value) && Number(value) > 0),
    "Release validity must be a whole number of days",
  ),
  notAutomatic: z.boolean(),
  butAutomaticUpgrades: z.boolean(),
  acquireByHash: z.boolean(),
}).refine(
  // apt only reads ButAutomaticUpgrades on a NotAutomatic suite, so the server
  // rejects it alone; saying so here beats a round trip to find out.
  (values) => !values.butAutomaticUpgrades || values.notAutomatic,
  { message: "But automatic upgrades requires Not automatic", path: ["butAutomaticUpgrades"] },
).refine(
  (values) => values.suite === "" || parseOptionalList(values.suites).length <= 1,
  { message: "Suite override cannot be set for a repository publishing more than one suite", path: ["suite"] },
).refine(
  // The codename is where a publish goes when it names no suite, so a list
  // that leaves it out makes every default publish fail.
  (values) => {
    const suites = parseOptionalList(values.suites);
    return suites.length === 0 || suites.includes(values.codename.trim());
  },
  { message: "Suites must include the codename", path: ["suites"] },
);

const aptRepositoryUpdateFormSchema = z.intersection(
  aptRepositoryBaseFormSchema,
  z.object({ signingKeyId: z.string().trim().min(1, "Signing key is required") }),
);

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

/**
 * Rebuilds `config.apt` from the form.
 *
 * `existing` carries whatever else was already stored. The form does not know
 * every key a repository can hold — a plugin release can add one, and the
 * advanced JSON editor can set anything — so rebuilding from the fields alone
 * would quietly delete the rest the first time someone pressed Save.
 */
function aptConfig(
  values: AptRepositoryFormValues,
  options: { signingKeyId?: string; existing?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const parsed = parseBaseForm(values);
  const suites = parseOptionalList(parsed.suites);
  const components = parseOptionalList(parsed.components);
  const architectures = parseOptionalList(parsed.architectures);
  const managed = {
    suites: suites.length > 0 ? suites : undefined,
    components: components.length > 0 ? components : undefined,
    architectures: architectures.length > 0 ? architectures : undefined,
    origin: parsed.origin || undefined,
    label: parsed.label || undefined,
    suite: parsed.suite || undefined,
    description: parsed.description || undefined,
    validityDays: parsed.validityDays === "" ? undefined : Number(parsed.validityDays),
    notAutomatic: parsed.notAutomatic ? true : undefined,
    butAutomaticUpgrades: parsed.butAutomaticUpgrades ? true : undefined,
    // Defaults to on, so only the deliberate opt-out is worth storing.
    acquireByHash: parsed.acquireByHash ? undefined : false,
  };

  const apt: Record<string, unknown> = { ...options.existing, codename: parsed.codename };
  for (const [key, value] of Object.entries(managed)) {
    if (value === undefined) {
      delete apt[key];
    } else {
      apt[key] = value;
    }
  }
  if (options.signingKeyId) {
    apt.signingKeyId = options.signingKeyId;
  }
  return { apt };
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

export function buildUpdateAptRepositoryInput(
  values: AptRepositoryFormValues,
  repository?: Repository,
): UpdateRepositoryInput {
  const parsed = parseUpdateForm(values);
  return {
    visibility: parsed.visibility,
    config: {
      ...repository?.config,
      ...aptConfig(values, {
        signingKeyId: parsed.signingKeyId,
        ...(repository ? { existing: aptConfigOf(repository) } : {}),
      }),
    },
  };
}

function aptConfigOf(repository: Repository): Record<string, unknown> {
  return repository.config.apt && typeof repository.config.apt === "object"
    ? repository.config.apt as Record<string, unknown>
    : {};
}

export function buildAptRepositoryFormValues(repository: Repository): AptRepositoryFormValues {
  const apt = aptConfigOf(repository);
  return {
    name: repository.name,
    visibility: repository.visibility,
    codename: typeof apt.codename === "string" ? apt.codename : "",
    suites: Array.isArray(apt.suites) ? apt.suites.join(" ") : "",
    components: Array.isArray(apt.components) ? apt.components.join(" ") : "",
    architectures: Array.isArray(apt.architectures) ? apt.architectures.join(" ") : "",
    origin: typeof apt.origin === "string" ? apt.origin : "",
    label: typeof apt.label === "string" ? apt.label : "",
    suite: typeof apt.suite === "string" ? apt.suite : "",
    description: typeof apt.description === "string" ? apt.description : "",
    validityDays: typeof apt.validityDays === "number" ? String(apt.validityDays) : "",
    notAutomatic: apt.notAutomatic === true,
    butAutomaticUpgrades: apt.butAutomaticUpgrades === true,
    acquireByHash: apt.acquireByHash !== false,
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

/**
 * The suites a form describes, or nothing when it just uses the codename.
 *
 * Exposed so the create wizard can reject a bad list on the step that asks for
 * it, instead of carrying the mistake to the signing key step.
 */
export function aptSuitesFor(values: AptRepositoryFormValues): string[] {
  return parseOptionalList(parseBaseForm(values).suites);
}

export function activeSigningKeys(keys: SigningKey[]): SigningKey[] {
  return keys.filter((key) => !key.revokedAt);
}

export function signingKeySetupPanelClass(): string {
  return "grid gap-4 rounded-lg border border-border bg-background p-4";
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
