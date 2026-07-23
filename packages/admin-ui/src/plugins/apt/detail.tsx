import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useAptSigningKeys, useUpdateRepository } from "../../api/hooks";
import type { Repository, RepositoryPlugin, SigningKey } from "../../api/schemas";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { AptSigningKeyDialog, AptSigningKeyList } from "../../pages/SigningKeysPage";
import { asJson, EmptyState, ErrorState } from "../../pages/shared";
import { RepositoryClientHelperSetup, VisibilitySelect } from "../../repository-detail-shared";
import {
  activeSigningKeys,
  buildAptRepositoryFormValues,
  buildUpdateAptRepositoryInput,
  type AptRepositoryFormValues,
} from "../../repository-forms";

export function AptRepositoryDetail({
  repository,
  pluginMetadata,
}: {
  repository: Repository;
  pluginMetadata: RepositoryPlugin | undefined;
}) {
  const [config, setConfig] = useState(asJson(repository.config));
  const [configError, setConfigError] = useState("");
  const [aptValues, setAptValues] = useState<AptRepositoryFormValues>(() => buildAptRepositoryFormValues(repository));
  const [aptError, setAptError] = useState("");
  const updateRepository = useUpdateRepository();
  const signingKeysQuery = useAptSigningKeys(repository.name, true);
  const signingKeys = signingKeysQuery.data ?? [];
  const activeKeys = activeSigningKeys(signingKeys);
  const aptSigningKeys = signingKeyOptions(activeKeys, signingKeys, aptValues.signingKeyId);

  useEffect(() => {
    setConfig(asJson(repository.config));
    setConfigError("");
    setAptValues(buildAptRepositoryFormValues(repository));
    setAptError("");
  }, [repository]);

  function updateAptField<K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) {
    setAptValues((current) => ({ ...current, [field]: value }));
  }

  async function saveJsonConfig() {
    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(config) as Record<string, unknown>;
      setConfigError("");
    } catch (error) {
      setConfigError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    updateRepository.mutate({
      name: repository.name,
      input: {
        visibility: aptValues.visibility,
        config: parsedConfig,
      },
    });
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
    <>
      <div className="grid gap-3">
        <AptRepositoryFields values={aptValues} signingKeys={aptSigningKeys} onChange={updateAptField} />
        {aptError && <ErrorState error={aptError} />}
        <Button onClick={saveAptConfig} disabled={updateRepository.isPending || aptSigningKeys.length === 0}>
          <Save className="mr-2 h-4 w-4" />
          Save repository
        </Button>
      </div>
      <details className="grid gap-3 border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-semibold">Advanced JSON config</summary>
        <div className="mt-3 grid gap-3">
          <Textarea value={config} onChange={(event) => setConfig(event.target.value)} />
          {configError && <ErrorState error={configError} />}
          <Button variant="outline" onClick={saveJsonConfig} disabled={updateRepository.isPending}>
            Save JSON config
          </Button>
        </div>
      </details>
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
      {signingKeysQuery.isError && (
        <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />
      )}
      <details className="grid gap-3 border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-semibold">APT signing keys</summary>
        <div className="mt-3 grid gap-3">
          <AptSigningKeyDialog repositoryName={repository.name} />
          <AptSigningKeyList repositoryName={repository.name} signingKeys={signingKeys} />
        </div>
      </details>
      <RepositoryClientHelperSetup
        repositoryName={repository.name}
        title="APT client setup"
        clientHelpers={pluginMetadata?.clientHelpers}
      />
    </>
  );
}

function AptRepositoryFields({
  values,
  signingKeys,
  onChange,
}: {
  values: AptRepositoryFormValues;
  signingKeys: SigningKey[];
  onChange: <K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) => void;
}) {
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
        <span className="text-sm font-medium">Components</span>
        <Input value={values.components} onChange={(event) => onChange("components", event.target.value)} placeholder="main contrib" required />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Architectures</span>
        <Input value={values.architectures} onChange={(event) => onChange("architectures", event.target.value)} placeholder="amd64 arm64" required />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Signing key</span>
        {signingKeys.length === 0 ? (
          <EmptyState message="No active signing key is available." />
        ) : (
          <Select value={values.signingKeyId} onValueChange={(value) => onChange("signingKeyId", value)}>
            <SelectTrigger>
              <SelectValue placeholder="Select signing key" />
            </SelectTrigger>
            <SelectContent>
              {signingKeys.map((key) => (
                <SelectItem key={key.id} value={key.id}>{key.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </label>
    </div>
  );
}

function signingKeyOptions(activeKeys: SigningKey[], allKeys: SigningKey[], currentId: string): SigningKey[] {
  if (!currentId || activeKeys.some((key) => key.id === currentId)) {
    return activeKeys;
  }
  const current = allKeys.find((key) => key.id === currentId);
  return current ? [current, ...activeKeys] : activeKeys;
}
