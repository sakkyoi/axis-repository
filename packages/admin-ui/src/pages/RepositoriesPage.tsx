import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Save } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import {
  useAptInstallInstructions,
  useCreateRepository,
  useAptSigningKeys,
  useRepositories,
  useUpdateRepository,
} from "../api/hooks";
import type { Repository, RepositoryVisibility, SigningKey } from "../api/schemas";
import {
  activeSigningKeys,
  buildAptRepositoryFormValues,
  buildCreateAptRepositoryInput,
  buildUpdateAptRepositoryInput,
  type AptRepositoryFormValues,
} from "../repository-forms";
import { AptSigningKeyDialog, AptSigningKeyList } from "./SigningKeysPage";
import { asJson, EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

const defaultAptRepositoryValues: AptRepositoryFormValues = {
  name: "",
  visibility: "private",
  codename: "noble",
  components: "main",
  architectures: "amd64",
  signingKeyId: "",
};

export function RepositoriesPage() {
  const repositories = useRepositories();
  const signingKeys = useAptSigningKeys();
  const [selectedName, setSelectedName] = useState<string>();
  const selected = useMemo(
    () => repositories.data?.find((repository) => repository.name === selectedName) ?? repositories.data?.[0],
    [repositories.data, selectedName],
  );

  return (
    <section>
      <PageHeader
        title="Repositories"
        description="Manage repository visibility, config, and client setup hints."
        action={(
          <div className="flex items-center gap-2">
            <AptSigningKeyDialog />
            <CreateRepositoryDialog signingKeys={signingKeys.data ?? []} />
          </div>
        )}
      />
      {repositories.isError && <ErrorState error={repositories.error} />}
      {signingKeys.isError && <ErrorState title="Signing keys unavailable" error={signingKeys.error} />}
      {repositories.isLoading && <div className="text-sm text-muted-foreground">Loading repositories...</div>}
      {repositories.data && repositories.data.length === 0 && <EmptyState message="No repositories have been created." />}
      <details className="mb-5 rounded-lg border border-border bg-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold">APT signing keys</summary>
        <div className="mt-4">
          <AptSigningKeyList signingKeys={signingKeys.data ?? []} />
        </div>
      </details>
      {repositories.data && repositories.data.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-5">
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Ecosystem</th>
                  <th className="px-3 py-2">Visibility</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {repositories.data.map((repository) => (
                  <tr
                    key={repository.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/60"
                    onClick={() => setSelectedName(repository.name)}
                  >
                    <td className="px-3 py-2 font-medium">{repository.name}</td>
                    <td className="px-3 py-2">{repository.ecosystem}</td>
                    <td className="px-3 py-2">
                      <Badge variant={repository.visibility === "public" ? "success" : "default"}>
                        {repository.visibility}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(repository.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && <RepositoryDetail repository={selected} signingKeys={signingKeys.data ?? []} />}
        </div>
      )}
    </section>
  );
}

function CreateRepositoryDialog({ signingKeys }: { signingKeys: SigningKey[] }) {
  const createRepository = useCreateRepository();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<AptRepositoryFormValues>(defaultAptRepositoryValues);
  const [error, setError] = useState("");
  const activeKeys = activeSigningKeys(signingKeys);

  function updateField<K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function openChanged(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setError("");
      setValues({
        ...defaultAptRepositoryValues,
        signingKeyId: activeKeys[0]?.id ?? "",
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await createRepository.mutateAsync(buildCreateAptRepositoryInput(values));
      setError("");
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Repository could not be created");
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChanged}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create repository
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create repository</DialogTitle>
          <DialogDescription>Create an APT repository with typed config and signing enabled.</DialogDescription>
        </DialogHeader>
        {activeKeys.length === 0 ? (
          <EmptyState message="Add an active signing key before creating an APT repository." />
        ) : (
          <form className="grid gap-3" onSubmit={submit}>
            <AptRepositoryFields
              values={values}
              signingKeys={activeKeys}
              onChange={updateField}
              includeName
            />
            <Button type="submit" disabled={createRepository.isPending}>
              Create repository
            </Button>
          </form>
        )}
        {(error || createRepository.isError) && <ErrorState error={error || createRepository.error} />}
      </DialogContent>
    </Dialog>
  );
}

function RepositoryDetail({ repository, signingKeys }: { repository: Repository; signingKeys: SigningKey[] }) {
  const [visibility, setVisibility] = useState<RepositoryVisibility>(repository.visibility);
  const [config, setConfig] = useState(asJson(repository.config));
  const [configError, setConfigError] = useState("");
  const [aptValues, setAptValues] = useState<AptRepositoryFormValues>(() => buildAptRepositoryFormValues(repository));
  const [aptError, setAptError] = useState("");
  const updateRepository = useUpdateRepository();
  const install = useAptInstallInstructions(repository.name, repository.ecosystem === "apt");
  const activeKeys = activeSigningKeys(signingKeys);
  const aptSigningKeys = signingKeyOptions(activeKeys, signingKeys, aptValues.signingKeyId);

  useEffect(() => {
    setVisibility(repository.visibility);
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
        visibility,
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
    <aside className="grid gap-4 rounded-lg border border-border bg-panel p-4">
      <div>
        <h2 className="text-base font-semibold">{repository.name}</h2>
        <p className="text-sm text-muted-foreground">{repository.ecosystem}</p>
      </div>
      {repository.ecosystem === "apt" && (
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
        </>
      )}
      {repository.ecosystem !== "apt" && (
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
        </>
      )}
      {updateRepository.isError && <ErrorState error={updateRepository.error} />}
      {repository.ecosystem === "apt" && (
        <div className="grid gap-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">APT client setup</h3>
          <a className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline" href={`/repositories/${repository.name}/apt/key.gpg`}>
            key.gpg <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline" href={`/repositories/${repository.name}/apt/source`}>
            source <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a className="inline-flex items-center gap-2 text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline" href={`/repositories/${repository.name}/apt/install`}>
            install <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {install.data && <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{asJson(install.data)}</pre>}
        </div>
      )}
    </aside>
  );
}

function AptRepositoryFields({
  values,
  signingKeys,
  onChange,
  includeName = false,
}: {
  values: AptRepositoryFormValues;
  signingKeys: SigningKey[];
  onChange: <K extends keyof AptRepositoryFormValues>(field: K, value: AptRepositoryFormValues[K]) => void;
  includeName?: boolean;
}) {
  return (
    <div className="grid gap-3">
      {includeName && (
        <label className="grid gap-2">
          <span className="text-sm font-medium">Name</span>
          <Input value={values.name} onChange={(event) => onChange("name", event.target.value)} placeholder="debian-internal" required />
        </label>
      )}
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
