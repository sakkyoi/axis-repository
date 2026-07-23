import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useRepositoryClientHelper, useUpdateRepository } from "./api/hooks";
import type { Repository, RepositoryClientHelperAction, RepositoryPlugin, RepositoryVisibility } from "./api/schemas";
import { Button } from "./components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { asJson, ErrorState } from "./pages/shared";

export function GenericRepositoryDetail({ repository }: { repository: Repository; pluginMetadata: RepositoryPlugin | undefined }) {
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

export function VisibilitySelect({ value, onChange }: { value: RepositoryVisibility; onChange: (value: RepositoryVisibility) => void }) {
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

function shellScriptFromHelperResponse(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data) || !("script" in data)) return undefined;
  const script = (data as { script?: unknown }).script;
  return typeof script === "string" ? script : undefined;
}

export function repositoryClientHelperDisplayText(
  action: Pick<RepositoryClientHelperAction, "responseKind" | "displayPath">,
  data: unknown,
): string {
  const displayData = action.displayPath && data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)[action.displayPath]
    : data;
  if (action.responseKind === "shell") {
    return shellScriptFromHelperResponse(displayData) ?? (typeof displayData === "string" ? displayData : asJson(displayData));
  }
  if (action.responseKind === "json") {
    return asJson(displayData);
  }
  return typeof displayData === "string" ? displayData : asJson(displayData);
}

export function RepositoryClientHelperSetup({
  repositoryName,
  title,
  clientHelpers,
}: {
  repositoryName: string;
  title: string;
  clientHelpers: RepositoryPlugin["clientHelpers"];
}) {
  if (!clientHelpers || clientHelpers.actions.length === 0) return null;
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {clientHelpers.actions.map((action) => (
        <RepositoryClientHelperItem
          key={action.name}
          repositoryName={repositoryName}
          namespace={clientHelpers.namespace}
          action={action}
        />
      ))}
    </div>
  );
}

export function RepositoryClientHelperItem({
  repositoryName,
  namespace,
  action,
}: {
  repositoryName: string;
  namespace: string;
  action: RepositoryClientHelperAction;
}) {
  const helper = useRepositoryClientHelper(repositoryName, namespace, action.name, true);
  return (
    <details className="min-w-0" open={action.defaultOpen}>
      <summary className="cursor-pointer text-sm font-medium">{action.label}</summary>
      <pre className="mt-2 max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
        {helper.data !== undefined ? repositoryClientHelperDisplayText(action, helper.data) : "Loading..."}
      </pre>
      {helper.isError && <ErrorState title={`${action.label} unavailable`} error={helper.error} />}
    </details>
  );
}
