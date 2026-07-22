import { type FormEvent, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, KeyRound, Package, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAptSigningKeys, useCreateRepository, useGenerateAptSigningKey, useImportAptSigningKey } from "../api/hooks";
import type { RepositoryVisibility, SigningKey } from "../api/schemas";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/utils";
import { ADMIN_UI_PATHS } from "../navigation";
import {
  getRepositoryCreatePlugin,
  repositoryCreatePlugins,
  type RepositoryCreateStep,
  type RepositoryCreateWizardState,
} from "../repository-create-plugins";
import { activeSigningKeys } from "../repository-forms";
import { asJson, ErrorState, PageHeader, formatDate } from "./shared";

const stepLabels: Record<RepositoryCreateStep, string> = {
  plugin: "Plugin",
  basics: "Basics",
  config: "Config",
  dependencies: "Dependencies",
  review: "Review",
};

export function NewRepositoryPage() {
  const navigate = useNavigate();
  const createRepository = useCreateRepository();
  const [selectedEcosystem, setSelectedEcosystem] = useState("apt");
  const plugin = getRepositoryCreatePlugin(selectedEcosystem);
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<RepositoryCreateWizardState>(plugin.defaults);
  const [error, setError] = useState("");
  const currentStep = plugin.steps[stepIndex] ?? "plugin";
  const stepErrors = plugin.validateStep(currentStep, state);
  const payload = useMemo(() => {
    try {
      return plugin.buildCreateInput(state);
    } catch {
      return null;
    }
  }, [plugin, state]);

  function selectPlugin(ecosystem: string) {
    const nextPlugin = getRepositoryCreatePlugin(ecosystem);
    setSelectedEcosystem(ecosystem);
    setState(nextPlugin.defaults);
    setStepIndex(1);
    setError("");
  }

  function updateState(patch: Partial<RepositoryCreateWizardState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function next() {
    const errors = plugin.validateStep(currentStep, state);
    if (errors.length > 0) {
      setError(errors[0] ?? "Step is invalid");
      return;
    }
    setError("");
    setStepIndex((current) => Math.min(current + 1, plugin.steps.length - 1));
  }

  async function create() {
    try {
      await createRepository.mutateAsync(plugin.buildCreateInput(state));
      navigate(ADMIN_UI_PATHS.repositories);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Repository could not be created");
    }
  }

  return (
    <section className="grid gap-5">
      <PageHeader
        title="Create repository"
        description="Choose a repository plugin, provide its config, then satisfy plugin dependencies."
        action={(
          <Button type="button" variant="outline" onClick={() => navigate(ADMIN_UI_PATHS.repositories)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Repositories
          </Button>
        )}
      />
      <StepIndicator steps={plugin.steps} currentStep={currentStep} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-border bg-panel p-5">
          {currentStep === "plugin" && (
            <PluginStep selectedEcosystem={selectedEcosystem} onSelect={selectPlugin} />
          )}
          {currentStep === "basics" && (
            <BasicsStep
              name={state.name}
              visibility={state.visibility}
              onNameChange={(name) => updateState({ name, dependencies: { ...state.dependencies, signingKeyId: "" } })}
              onVisibilityChange={(visibility) => updateState({ visibility })}
            />
          )}
          {currentStep === "config" && selectedEcosystem === "apt" && (
            <AptConfigStep
              config={state.config}
              onChange={(config) => updateState({ config })}
            />
          )}
          {currentStep === "dependencies" && selectedEcosystem === "apt" && (
            <AptDependenciesStep
              repositoryName={state.name.trim()}
              signingKeyId={state.dependencies.signingKeyId ?? ""}
              onSigningKeyChange={(signingKeyId) => updateState({ dependencies: { ...state.dependencies, signingKeyId } })}
            />
          )}
          {currentStep === "review" && (
            <ReviewStep payload={payload} />
          )}
          {(error || createRepository.isError) && (
            <div className="mt-4">
              <ErrorState error={error || createRepository.error} />
            </div>
          )}
        </div>
        <aside className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">{plugin.displayName}</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{plugin.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {plugin.capabilities.map((capability) => (
              <span key={capability} className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                {capability}
              </span>
            ))}
          </div>
        </aside>
      </div>
      <div className="sticky bottom-0 flex items-center justify-between border-t border-border bg-background/95 py-4 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          disabled={stepIndex === 0}
          onClick={() => {
            setError("");
            setStepIndex((current) => Math.max(current - 1, 0));
          }}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        {currentStep === "review" ? (
          <Button type="button" disabled={createRepository.isPending || !payload} onClick={create}>
            <Check className="mr-2 h-4 w-4" />
            Create repository
          </Button>
        ) : (
          <Button type="button" disabled={stepErrors.length > 0 && currentStep !== "plugin"} onClick={next}>
            Next
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </section>
  );
}

function StepIndicator({ steps, currentStep }: { steps: RepositoryCreateStep[]; currentStep: RepositoryCreateStep }) {
  const currentIndex = steps.indexOf(currentStep);
  return (
    <ol className="grid grid-cols-5 overflow-hidden rounded-lg border border-border bg-panel">
      {steps.map((step, index) => {
        const isCurrent = step === currentStep;
        const isDone = index < currentIndex;
        return (
          <li
            key={step}
            className={cn(
              "flex min-h-12 items-center gap-2 border-r border-border px-3 text-sm last:border-r-0",
              isCurrent && "bg-primary text-primary-foreground",
              isDone && "bg-muted text-foreground",
              !isCurrent && !isDone && "text-muted-foreground",
            )}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current text-xs">
              {isDone ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="font-medium">{stepLabels[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function PluginStep({ selectedEcosystem, onSelect }: { selectedEcosystem: string; onSelect: (ecosystem: string) => void }) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">Repository plugin</h2>
        <p className="mt-1 text-sm text-muted-foreground">Start by choosing the repository type this instance can provide.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {repositoryCreatePlugins.map((plugin) => (
          <button
            key={plugin.ecosystem}
            type="button"
            className={cn(
              "grid gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted",
              selectedEcosystem === plugin.ecosystem && "border-primary bg-primary/10",
            )}
            onClick={() => onSelect(plugin.ecosystem)}
          >
            <span className="text-sm font-semibold">{plugin.displayName}</span>
            <span className="text-sm text-muted-foreground">{plugin.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BasicsStep({
  name,
  visibility,
  onNameChange,
  onVisibilityChange,
}: {
  name: string;
  visibility: RepositoryVisibility;
  onNameChange: (name: string) => void;
  onVisibilityChange: (visibility: RepositoryVisibility) => void;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">Basics</h2>
        <p className="mt-1 text-sm text-muted-foreground">Name the repository and choose how clients can access it.</p>
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Repository name</span>
        <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="debian-internal" required />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Visibility</span>
        <Select value={visibility} onValueChange={(value) => onVisibilityChange(value as RepositoryVisibility)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">private</SelectItem>
            <SelectItem value="public">public</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function AptConfigStep({
  config,
  onChange,
}: {
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
}) {
  function update(field: string, value: string) {
    onChange({ ...config, [field]: value });
  }

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">APT config</h2>
        <p className="mt-1 text-sm text-muted-foreground">Define the Debian distribution metadata this repository will publish.</p>
      </div>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Codename</span>
        <Input value={config.codename ?? ""} onChange={(event) => update("codename", event.target.value)} placeholder="noble" required />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Components</span>
        <Input value={config.components ?? ""} onChange={(event) => update("components", event.target.value)} placeholder="main contrib" required />
      </label>
      <label className="grid gap-2">
        <span className="text-sm font-medium">Architectures</span>
        <Input value={config.architectures ?? ""} onChange={(event) => update("architectures", event.target.value)} placeholder="amd64 arm64" required />
      </label>
    </div>
  );
}

function AptDependenciesStep({
  repositoryName,
  signingKeyId,
  onSigningKeyChange,
}: {
  repositoryName: string;
  signingKeyId: string;
  onSigningKeyChange: (id: string) => void;
}) {
  const signingKeysQuery = useAptSigningKeys(repositoryName, Boolean(repositoryName));
  const signingKeys = signingKeysQuery.data ?? [];
  const activeKeys = activeSigningKeys(signingKeys);

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">APT dependencies</h2>
        <p className="mt-1 text-sm text-muted-foreground">APT repositories need a repository-scoped OpenPGP signing key before creation.</p>
      </div>
      {!repositoryName ? (
        <ErrorState title="Repository name required" error={new Error("Go back and enter a repository name before configuring dependencies.")} />
      ) : (
        <>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Signing key</span>
            {activeKeys.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                No active signing key is scoped to {repositoryName}.
              </div>
            ) : (
              <Select value={signingKeyId} onValueChange={onSigningKeyChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select signing key" />
                </SelectTrigger>
                <SelectContent>
                  {activeKeys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>{key.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </label>
          <InlineAptSigningKeyForm repositoryName={repositoryName} onCreated={(key) => onSigningKeyChange(key.id)} />
          {signingKeys.length > 0 && <SigningKeySummary signingKeys={signingKeys} />}
          {signingKeysQuery.isError && <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />}
        </>
      )}
    </div>
  );
}

function InlineAptSigningKeyForm({
  repositoryName,
  onCreated,
}: {
  repositoryName: string;
  onCreated: (key: SigningKey) => void;
}) {
  const generateKey = useGenerateAptSigningKey();
  const importKey = useImportAptSigningKey();
  const [error, setError] = useState("");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const key = await generateKey.mutateAsync({
        repositoryName,
        input: {
          name: String(form.get("name") ?? ""),
          userIdName: String(form.get("userIdName") ?? ""),
          userIdEmail: String(form.get("userIdEmail") ?? ""),
        },
      });
      setError("");
      onCreated(key);
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Signing key could not be generated");
    }
  }

  async function importSigningKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const key = await importKey.mutateAsync({
        repositoryName,
        input: {
          name: String(form.get("name") ?? ""),
          privateKeyArmored: String(form.get("privateKeyArmored") ?? ""),
          passphrase: String(form.get("passphrase") ?? ""),
        },
      });
      setError("");
      onCreated(key);
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Signing key could not be imported");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Create signing key</h3>
      </div>
      <Tabs defaultValue="generate">
        <TabsList>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>
        <TabsContent value="generate">
          <form className="grid gap-3" onSubmit={generate}>
            <Input name="name" placeholder="release" required />
            <Input name="userIdName" placeholder="Axis Repository" required />
            <Input name="userIdEmail" type="email" placeholder="axis@example.local" required />
            <Button type="submit" disabled={generateKey.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Generate key
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="import">
          <form className="grid gap-3" onSubmit={importSigningKey}>
            <Input name="name" placeholder="release" required />
            <Textarea name="privateKeyArmored" placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" required />
            <Input name="passphrase" type="password" placeholder="Passphrase" required />
            <Button type="submit" disabled={importKey.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Import key
            </Button>
          </form>
        </TabsContent>
      </Tabs>
      {(error || generateKey.isError || importKey.isError) && (
        <div className="mt-3">
          <ErrorState error={error || generateKey.error || importKey.error} />
        </div>
      )}
    </div>
  );
}

function SigningKeySummary({ signingKeys }: { signingKeys: SigningKey[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Key ID</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {signingKeys.map((key) => (
            <tr key={key.id} className="border-t border-border">
              <td className="px-3 py-2 font-medium">{key.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{key.keyId}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatDate(key.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewStep({ payload }: { payload: unknown }) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">Review</h2>
        <p className="mt-1 text-sm text-muted-foreground">Confirm the request before creating the repository.</p>
      </div>
      <pre className="max-h-[520px] overflow-auto rounded-md bg-muted p-4 text-xs">{asJson(payload)}</pre>
    </div>
  );
}
