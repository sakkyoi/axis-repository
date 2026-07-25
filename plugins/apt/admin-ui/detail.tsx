import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
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
        input: buildUpdateAptRepositoryInput(aptValues),
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
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
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
  const currentSigningKeyId = buildAptRepositoryFormValues(repository).signingKeyId;

  async function setPrimarySigningKey(signingKey: SigningKey) {
    await updateRepository.mutateAsync({
      name: repository.name,
      input: buildUpdateAptRepositoryInput({
        ...buildAptRepositoryFormValues(repository),
        signingKeyId: signingKey.id,
      }),
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
      {updateRepository.isError && <ErrorState title="Signing key could not be set as primary" error={updateRepository.error} />}
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
        <span className="text-sm font-medium">Component allowlist</span>
        <Input value={values.components} onChange={(event) => onChange("components", event.target.value)} placeholder="default: main" />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Architecture allowlist</span>
        <Input value={values.architectures} onChange={(event) => onChange("architectures", event.target.value)} placeholder="auto-detect" />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Signing key</span>
        {signingKeyState.currentKeyRevoked && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
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
