import { useEffect, useState, type ComponentType } from "react";
import { Save } from "lucide-react";
import {
  useAptInstallInstructions,
  useAptSigningKeys,
  useAptSigningPublicKey,
  useAptSourceInfo,
  usePypiClientInfo,
  useUpdateRepository,
} from "./api/hooks";
import type { Repository, RepositoryVisibility, SigningKey } from "./api/schemas";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { aptInstallCommandText } from "./repository-page-model";
import {
  activeSigningKeys,
  buildAptRepositoryFormValues,
  buildUpdateAptRepositoryInput,
  type AptRepositoryFormValues,
} from "./repository-forms";
import { AptSigningKeyDialog, AptSigningKeyList } from "./pages/SigningKeysPage";
import { asJson, EmptyState, ErrorState } from "./pages/shared";

export interface RepositoryDetailPlugin {
  ecosystem: string;
  displayName: string;
  Detail: ComponentType<{ repository: Repository }>;
}

export function GenericRepositoryDetail({ repository }: { repository: Repository }) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>(repository.visibility);
  const [config, setConfig] = useState(asJson(repository.config));
  const [configError, setConfigError] = useState("");
  const updateRepository = useUpdateRepository();

  useEffect(() => {
    setVisibility(repository.visibility);
    setConfig(asJson(repository.config));
    setConfigError("");
  }, [repository]);

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
        visibility,
        config: parsedConfig,
      },
    });
  }

  return (
    <>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Visibility</span>
        <VisibilitySelect value={visibility} onChange={setVisibility} />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Config JSON</span>
        <Textarea value={config} onChange={(event) => setConfig(event.target.value)} />
      </label>
      {configError && <ErrorState error={configError} />}
      <Button onClick={saveJsonConfig} disabled={updateRepository.isPending}>
        <Save className="mr-2 h-4 w-4" />
        Save repository
      </Button>
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
    </>
  );
}

function AptRepositoryDetail({ repository }: { repository: Repository }) {
  const [config, setConfig] = useState(asJson(repository.config));
  const [configError, setConfigError] = useState("");
  const [aptValues, setAptValues] = useState<AptRepositoryFormValues>(() => buildAptRepositoryFormValues(repository));
  const [aptError, setAptError] = useState("");
  const updateRepository = useUpdateRepository();
  const install = useAptInstallInstructions(repository.name, true);
  const publicKey = useAptSigningPublicKey(repository.name, true);
  const source = useAptSourceInfo(repository.name, true);
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
      <div className="grid gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">APT client setup</h3>
        <details className="min-w-0">
          <summary className="cursor-pointer text-sm font-medium">key.gpg</summary>
          <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{publicKey.data ?? "Loading..."}</pre>
        </details>
        <details className="min-w-0">
          <summary className="cursor-pointer text-sm font-medium">source</summary>
          <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{source.data ? asJson(source.data) : "Loading..."}</pre>
        </details>
        <details className="min-w-0" open>
          <summary className="cursor-pointer text-sm font-medium">install</summary>
          <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{install.data ? aptInstallCommandText(install.data) : "Loading..."}</pre>
        </details>
        {publicKey.isError && <ErrorState title="APT key unavailable" error={publicKey.error} />}
        {source.isError && <ErrorState title="APT source unavailable" error={source.error} />}
        {install.isError && <ErrorState title="APT install unavailable" error={install.error} />}
      </div>
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

function VisibilitySelect({ value, onChange }: { value: RepositoryVisibility; onChange: (value: RepositoryVisibility) => void }) {
  return (
    <Select value={value} onValueChange={(nextValue) => onChange(nextValue as RepositoryVisibility)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="private">private</SelectItem>
        <SelectItem value="public">public</SelectItem>
      </SelectContent>
    </Select>
  );
}

function signingKeyOptions(activeKeys: SigningKey[], allKeys: SigningKey[], currentId: string): SigningKey[] {
  if (!currentId || activeKeys.some((key) => key.id === currentId)) {
    return activeKeys;
  }
  const current = allKeys.find((key) => key.id === currentId);
  return current ? [current, ...activeKeys] : activeKeys;
}

export function pypiSimpleIndexUrl(repository: Repository): string {
  return `/repositories/${repository.name}/simple/`;
}

function pypiAuthenticatedIndexUrl(pipIndexUrl: string): string {
  try {
    const url = new URL(pipIndexUrl);
    return `${url.protocol}//axis:\${AXIS_PYPI_TOKEN}@${url.host}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return pipIndexUrl;
  }
}

export function pypiInstallCommandText(repository: Repository, pipIndexUrl = pypiSimpleIndexUrl(repository)): string {
  if (repository.visibility === "private") {
    return [
      "# Use a read token for private repositories.",
      "export AXIS_PYPI_TOKEN=\"<READ_TOKEN>\"",
      "",
      "# Install packages from this repository.",
      "pip install \\",
      `  --index-url "${pypiAuthenticatedIndexUrl(pipIndexUrl)}" \\`,
      "  <package>",
    ].join("\n");
  }
  return [
    "# Install packages from this repository.",
    "pip install \\",
    `  --index-url "${pipIndexUrl}" \\`,
    "  <package>",
  ].join("\n");
}

function PypiRepositoryDetail({ repository }: { repository: Repository }) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>(repository.visibility);
  const updateRepository = useUpdateRepository();
  const clientInfo = usePypiClientInfo(repository.name, true);

  useEffect(() => {
    setVisibility(repository.visibility);
  }, [repository]);

  async function savePypiConfig() {
    updateRepository.mutate({
      name: repository.name,
      input: {
        visibility,
        config: repository.config,
      },
    });
  }

  return (
    <>
      <div className="grid gap-3">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Visibility</span>
          <VisibilitySelect value={visibility} onChange={setVisibility} />
        </label>
        <Button onClick={savePypiConfig} disabled={updateRepository.isPending}>
          <Save className="mr-2 h-4 w-4" />
          Save repository
        </Button>
      </div>
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
      <div className="grid gap-3 border-t border-border pt-4">
        <h3 className="text-sm font-semibold">PyPI client setup</h3>
        <details className="min-w-0" open>
          <summary className="cursor-pointer text-sm font-medium">Simple API URL</summary>
          <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{clientInfo.data?.simpleUrl ?? "Loading..."}</pre>
        </details>
        <details className="min-w-0" open>
          <summary className="cursor-pointer text-sm font-medium">pip install</summary>
          <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{clientInfo.data ? pypiInstallCommandText({ ...repository, visibility }, clientInfo.data.pipIndexUrl) : "Loading..."}</pre>
        </details>
        {clientInfo.isError && <ErrorState title="PyPI client setup unavailable" error={clientInfo.error} />}
      </div>
    </>
  );
}

export const aptRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: "apt",
  displayName: "APT",
  Detail: AptRepositoryDetail,
};

export const pypiRepositoryDetailPlugin: RepositoryDetailPlugin = {
  ecosystem: "pypi",
  displayName: "PyPI",
  Detail: PypiRepositoryDetail,
};

export const repositoryDetailPlugins = [aptRepositoryDetailPlugin, pypiRepositoryDetailPlugin] as const;

export function getRepositoryDetailPlugin(ecosystem: string): RepositoryDetailPlugin | undefined {
  return repositoryDetailPlugins.find((plugin) => plugin.ecosystem === ecosystem);
}
