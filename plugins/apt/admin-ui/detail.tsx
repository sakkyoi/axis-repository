import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  useErrorToast,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useUpdateRepository,
  VisibilitySelect,
  type Repository,
  type RepositoryPlugin,
  type SigningKey,
} from "@axis-repository/admin-ui/plugin-ui";
import { useAptSigningKeys } from "./api";
import { AptSigningKeyDialog, AptSigningKeyList } from "./signing-keys";
import { aptSigningKeySettingsState } from "./signing-keys-model";
import {
  buildAptRepositoryFormValues,
  buildUpdateAptRepositoryInput,
  type AptRepositoryFormValues,
} from "./forms";

export function AptSettingsSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const [aptValues, setAptValues] = useState<AptRepositoryFormValues>(() => buildAptRepositoryFormValues(repository));
  const [aptError, setAptError] = useState("");
  const updateRepository = useUpdateRepository();
  useErrorToast("Repository not saved", updateRepository.error);
  const signingKeysQuery = useAptSigningKeys(repository.name, true);
  const signingKeys = signingKeysQuery.data ?? [];
  const signingKeyState = aptSigningKeySettingsState({
    signingKeys,
    currentSigningKeyId: buildAptRepositoryFormValues(repository).signingKeyId,
  });
  const selectedActiveSigningKey = signingKeyState.activeKeys.find((key) => key.id === aptValues.signingKeyId);

  useEffect(() => {
    setAptValues(buildAptRepositoryFormValues(repository));
    setAptError("");
  }, [repository]);

  function updateAptField<K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) {
    setAptValues((current) => ({ ...current, [field]: value }));
  }

  async function saveAptConfig() {
    try {
      await updateRepository.mutateAsync({
        name: repository.name,
        input: buildUpdateAptRepositoryInput(aptValues, repository),
      });
      setAptError("");
    } catch (caught) {
      setAptError(caught instanceof Error ? caught.message : "Repository could not be saved");
    }
  }

  return (
    <div className="grid gap-3">
      <AptRepositoryFields
        values={aptValues}
        signingKeyState={signingKeyState}
        onChange={updateAptField}
      />
      {aptError && <ErrorState error={aptError} />}
      <Button onClick={saveAptConfig} disabled={updateRepository.isPending || !selectedActiveSigningKey}>
        <Save className="mr-2 h-4 w-4" />
        Save repository
      </Button>
      {signingKeysQuery.isError && <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />}
    </div>
  );
}

export function AptSigningKeysSection({
  repository,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const signingKeysQuery = useAptSigningKeys(repository.name, true);
  const signingKeys = signingKeysQuery.data ?? [];
  const updateRepository = useUpdateRepository();
  useErrorToast("Signing key could not be set as primary", updateRepository.error);
  const currentSigningKeyId = buildAptRepositoryFormValues(repository).signingKeyId;

  async function setPrimarySigningKey(signingKey: SigningKey) {
    await updateRepository.mutateAsync({
      name: repository.name,
      input: buildUpdateAptRepositoryInput({
        ...buildAptRepositoryFormValues(repository),
        signingKeyId: signingKey.id,
      }, repository),
    });
  }

  return (
    <div className="grid gap-3">
      <AptSigningKeyDialog
        repositoryName={repository.name}
        onSetPrimarySigningKey={setPrimarySigningKey}
      />
      <AptSigningKeyList
        repositoryName={repository.name}
        signingKeys={signingKeys}
        currentSigningKeyId={currentSigningKeyId}
      />
      {signingKeysQuery.isError && <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />}
    </div>
  );
}

function AptRepositoryFields({
  values,
  signingKeyState,
  onChange,
}: {
  values: AptRepositoryFormValues;
  signingKeyState: ReturnType<typeof aptSigningKeySettingsState>;
  onChange: <K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) => void;
}) {
  const selectedActiveSigningKey = signingKeyState.activeKeys.find((key) => key.id === values.signingKeyId);
  return (
    <div className="grid gap-3">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Visibility</span>
        <VisibilitySelect value={values.visibility} onChange={(value) => onChange("visibility", value)} />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Codename</span>
        <Input value={values.codename} onChange={(event) => onChange("codename", event.target.value)} placeholder="noble" required />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Suites</span>
        <Input value={values.suites} onChange={(event) => onChange("suites", event.target.value)} placeholder={`default: ${values.codename || "codename"}`} />
        <span className="text-xs text-muted-foreground">
          Every suite this repository publishes, space separated. Must include the codename.
        </span>
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Component allowlist</span>
        <Input value={values.components} onChange={(event) => onChange("components", event.target.value)} placeholder="default: main" />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Architecture allowlist</span>
        <Input value={values.architectures} onChange={(event) => onChange("architectures", event.target.value)} placeholder="auto-detect" />
      </label>
      <AptReleaseFields values={values} onChange={onChange} />
      <label className="grid gap-2">
        <span className="text-sm font-medium">Signing key</span>
        {signingKeyState.currentKeyRevoked && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-ink">
            Current signing key has been revoked. Select an active signing key before publishing.
          </div>
        )}
        {!signingKeyState.hasActiveKey ? (
          <EmptyState message="No active signing key is available. Generate or import one to enable publishing." />
        ) : (
          <Select
            value={selectedActiveSigningKey ? values.signingKeyId ?? "" : ""}
            onValueChange={(value) => onChange("signingKeyId", value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select signing key" />
            </SelectTrigger>
            <SelectContent>
              {signingKeyState.activeKeys.map((key) => (
                <SelectItem key={key.id} value={key.id}>{key.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </label>
    </div>
  );
}

/**
 * The `Release` fields, which describe the repository rather than shape it.
 *
 * They are separated from the fields above because changing one of these is
 * safe at any time: nothing already published moves, and the next write picks
 * them up. The codename, suites, components and architectures decide where
 * files live, so changing those can orphan what is already there.
 */
function AptReleaseFields({
  values,
  onChange,
}: {
  values: AptRepositoryFormValues;
  onChange: <K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) => void;
}) {
  return (
    <>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Origin</span>
        <Input value={values.origin} onChange={(event) => onChange("origin", event.target.value)} placeholder="default: repository name" />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Label</span>
        <Input value={values.label} onChange={(event) => onChange("label", event.target.value)} placeholder="default: repository name" />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Suite override</span>
        <Input value={values.suite} onChange={(event) => onChange("suite", event.target.value)} placeholder="default: codename" />
        <span className="text-xs text-muted-foreground">
          Publishes as a named suite such as stable, when that differs from the codename. Only for a repository with one suite.
        </span>
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Description</span>
        <Input value={values.description} onChange={(event) => onChange("description", event.target.value)} placeholder="optional" />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Release validity (days)</span>
        <Input
          type="number"
          min={1}
          value={values.validityDays}
          onChange={(event) => onChange("validityDays", event.target.value)}
          placeholder="never expires"
        />
        <span className="text-xs text-muted-foreground">
          Writes Valid-Until, so a stale mirror cannot hold clients on an old package set. Axis re-signs before it lapses, so you do not have to keep publishing.
        </span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={values.notAutomatic}
          onChange={(event) => onChange("notAutomatic", event.target.checked)}
        />
        <span className="text-sm font-medium">Not automatic</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={values.butAutomaticUpgrades}
          disabled={!values.notAutomatic}
          onChange={(event) => onChange("butAutomaticUpgrades", event.target.checked)}
        />
        <span className="text-sm font-medium">But automatic upgrades</span>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={values.acquireByHash}
          onChange={(event) => onChange("acquireByHash", event.target.checked)}
        />
        <span className="text-sm font-medium">Publish indexes under by-hash</span>
      </label>
    </>
  );
}
