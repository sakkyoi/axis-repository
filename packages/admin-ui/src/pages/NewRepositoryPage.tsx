import { useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Package } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  useCreateRepository,
  useRepositories,
  useRepositoryPlugins,
} from "../api/hooks";
import type { RepositoryVisibility } from "../api/schemas";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { cn } from "../lib/utils";
import { ADMIN_UI_PATHS } from "../navigation";
import { RepositoryDependencyFields } from "../repositories/create/repository-create-dependency-renderer";
import {
  repositoryCreateAvailabilityError,
  repositoryCreateFieldErrors,
  repositoryCreateStepForServerError,
} from "../repositories/plugins/repository-create-plugins";
import type {
  RepositoryCreateFieldErrors,
  RepositoryCreateFieldRendererMap,
  RepositoryCreatePlugin,
  RepositoryCreatePluginOption,
  RepositoryCreateStep,
  RepositoryCreateWizardState,
} from "../repositories/plugins/repository-ui-plugin-types";
import {
  getRepositoryCreateFieldRenderers,
  getRepositoryCreatePlugin,
  getRepositoryPluginManifest,
  repositoryCreatePluginOptionsFromUiRegistry,
  repositoryCreatePluginsFromUiRegistry,
} from "../repositories/plugins/repository-ui-plugins";
import { repositoryConfigFieldsForStep } from "../repositories/create/repository-create-field-model";
import { RepositoryConfigFields } from "../repositories/create/repository-create-field-renderer";
import { CodeBlock } from "../components/ui/code-block";
import { asJson, ErrorState, PageShell } from "./shared";
import { SkeletonRows } from "../components/ui/skeleton";
import { useErrorToast } from "../components/ui/toast";

const stepLabels: Record<RepositoryCreateStep, string> = {
  plugin: "Plugin",
  basics: "Basics",
  config: "Config",
  setup: "Setup",
  review: "Review",
};

export function NewRepositoryPage() {
  const navigate = useNavigate();
  const createRepository = useCreateRepository();
  useErrorToast("Repository not created", createRepository.error);
  const repositories = useRepositories();
  const repositoryPlugins = useRepositoryPlugins();
  const pluginOptions = useMemo(
    () => repositoryCreatePluginOptionsFromUiRegistry(repositoryPlugins.data ?? []),
    [repositoryPlugins.data],
  );
  const repositoryCreatePlugins = repositoryCreatePluginsFromUiRegistry();
  const firstSupportedPlugin = pluginOptions.find((option) => option.supported)?.plugin ?? repositoryCreatePlugins[0];
  const [selectedEcosystem, setSelectedEcosystem] = useState(firstSupportedPlugin.ecosystem);
  const selectedOption = pluginOptions.find((option) => option.ecosystem === selectedEcosystem && option.supported);
  const plugin = selectedOption?.supported ? selectedOption.plugin : firstSupportedPlugin;
  const pluginManifest = getRepositoryPluginManifest(plugin.ecosystem);
  const canUseSelectedPlugin = Boolean(selectedOption);
  const summaryTitle = repositoryPlugins.isLoading
    ? "Loading plugins"
    : selectedOption ? selectedOption.displayName : "No supported plugin";
  const summaryDescription = repositoryPlugins.isLoading
    ? "Checking which repository plugins this server has enabled."
    : selectedOption
      ? selectedOption.description
      : "This server has no repository plugin that the current admin UI can create.";
  const summaryCapabilities = selectedOption?.capabilities ?? [];
  const summaryBadges = selectedOption?.badges ?? [];
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<RepositoryCreateWizardState>(plugin.defaults);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<RepositoryCreateFieldErrors>({});
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
    if (!nextPlugin) {
      throw new Error(`Repository UI plugin is not configured: ${ecosystem}`);
    }
    setSelectedEcosystem(ecosystem);
    setState(nextPlugin.defaults);
    setStepIndex(1);
    setError("");
    setFieldErrors({});
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
    if (currentStep === "basics") {
      const availabilityError = repositoryCreateAvailabilityError(
        state.name,
        repositories.data?.map((repository) => repository.name) ?? [],
      );
      if (availabilityError) {
        setFieldErrors(repositoryCreateFieldErrors(availabilityError));
        setError(availabilityError);
        return;
      }
    }
    setError("");
    setFieldErrors({});
    setStepIndex((current) => Math.min(current + 1, plugin.steps.length - 1));
  }

  async function create() {
    try {
      await createRepository.mutateAsync(plugin.buildCreateInput(state));
      void navigate(ADMIN_UI_PATHS.repositories);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Repository could not be created";
      const targetStep = repositoryCreateStepForServerError(message, plugin);
      if (targetStep) {
        setStepIndex(plugin.steps.indexOf(targetStep));
      }
      setFieldErrors(repositoryCreateFieldErrors(message));
      setError(message);
    }
  }

  return (
    <PageShell
      title="Create repository"
      description="Choose a repository plugin, provide its config, then choose plugin setup actions."
      bodyClassName="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-5 overflow-hidden pr-0"
      action={(
        <Button type="button" variant="outline" onClick={() => navigate(ADMIN_UI_PATHS.repositories)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Repositories
        </Button>
      )}
    >
      <StepIndicator steps={plugin.steps} currentStep={currentStep} />
      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-panel p-5">
          {currentStep === "plugin" && (
            <PluginStep
              options={pluginOptions}
              isLoading={repositoryPlugins.isLoading}
              error={repositoryPlugins.error}
              selectedEcosystem={selectedEcosystem}
              onSelect={selectPlugin}
            />
          )}
          {currentStep === "basics" && (
            <BasicsStep
              name={state.name}
              visibility={state.visibility}
              {...(fieldErrors.name ? { nameError: fieldErrors.name } : {})}
              onNameChange={(name) => {
                setFieldErrors((current) => {
                  const { name: _name, ...rest } = current;
                  return rest;
                });
                updateState({ name, setup: { ...state.setup, signingKeyExistingId: "" } });
              }}
              onVisibilityChange={(visibility) => updateState({ visibility })}
            />
          )}
          {currentStep === "config" && (
            <ConfigStep
              plugin={plugin}
              displayName={pluginManifest?.displayName ?? plugin.ecosystem}
              fieldRenderers={getRepositoryCreateFieldRenderers(plugin.ecosystem)}
              repositoryName={state.name.trim()}
              config={state.config}
              onChange={(config) => updateState({ config })}
            />
          )}
          {currentStep === "setup" && (
            <DependenciesStep
              plugin={plugin}
              displayName={pluginManifest?.displayName ?? plugin.ecosystem}
              fieldRenderers={getRepositoryCreateFieldRenderers(plugin.ecosystem)}
              repositoryName={state.name.trim()}
              setup={state.setup}
              onChange={(setup) => updateState({ setup })}
            />
          )}
          {currentStep === "review" && (
            <ReviewStep payload={payload} />
          )}
          {/* What the form itself objects to stays with the form; what the
              server refused is raised in the corner like every other failure. */}
          {Boolean(error) && (
            <div className="mt-4">
              <ErrorState error={error} />
            </div>
          )}
        </div>
        <aside className="min-h-0 overflow-y-auto rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary-ink" />
            <h2 className="text-sm font-semibold">{summaryTitle}</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{summaryDescription}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {summaryBadges.map((badge) => (
              <Badge key={badge.label} variant={badge.variant}>{badge.label}</Badge>
            ))}
            {summaryCapabilities.map((capability) => (
              <span key={capability} className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                {capability}
              </span>
            ))}
          </div>
        </aside>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border bg-background/95 py-4 backdrop-blur">
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
          <Button
            type="button"
            disabled={(stepErrors.length > 0 && currentStep !== "plugin") || (currentStep === "plugin" && !canUseSelectedPlugin)}
            onClick={next}
          >
            Next
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </PageShell>
  );
}

function StepIndicator({ steps, currentStep }: { steps: RepositoryCreateStep[]; currentStep: RepositoryCreateStep }) {
  const currentIndex = steps.indexOf(currentStep);
  return (
    <ol
      className="grid overflow-hidden rounded-lg border border-border bg-panel"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((step, index) => {
        const isCurrent = step === currentStep;
        const isDone = index < currentIndex;
        return (
          <li
            key={step}
            className={cn(
              "flex min-h-12 items-center gap-2 border-r border-border px-3 text-sm last:border-r-0",
              // Tinted rather than filled, like every other chosen thing: this
              // says where you are, it is not a button.
              isCurrent && "bg-primary-ink/10 text-primary-ink",
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

function PluginStep({
  options,
  isLoading,
  error,
  selectedEcosystem,
  onSelect,
}: {
  options: RepositoryCreatePluginOption[];
  isLoading: boolean;
  error: unknown;
  selectedEcosystem: string;
  onSelect: (ecosystem: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">Repository plugin</h2>
        <p className="mt-1 text-sm text-muted-foreground">Start by choosing the repository type this instance can provide.</p>
      </div>
      {isLoading && <SkeletonRows rows={3} columns={["w-24", "w-40"]} className="p-0" />}
      {Boolean(error) && <ErrorState title="Repository plugins unavailable" error={error} />}
      {!isLoading && !error && options.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          No repository plugins are enabled on this server.
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {options.map((plugin) => {
          const detailBadges = plugin.badges.filter((badge) => badge.label !== plugin.lifecycle.label);
          return (
            <button
              key={plugin.ecosystem}
              type="button"
              disabled={!plugin.supported}
              className={cn(
                "grid gap-2 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary hover:bg-muted",
                selectedEcosystem === plugin.ecosystem && "border-primary bg-primary-ink/10",
                !plugin.supported && "cursor-not-allowed opacity-60 hover:border-border hover:bg-background",
              )}
              onClick={() => {
                if (plugin.supported) onSelect(plugin.ecosystem);
              }}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                {plugin.displayName}
                <Badge variant={plugin.lifecycle.variant}>{plugin.lifecycle.label}</Badge>
              </span>
              <span className="text-sm text-muted-foreground">{plugin.description}</span>
              {!plugin.supported && plugin.disabledReason && (
                <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive-ink">
                  {plugin.disabledReason}
                </span>
              )}
              {detailBadges.length > 0 && (
                <span className="flex flex-wrap gap-1.5">
                  {detailBadges.map((badge) => (
                    <Badge key={badge.label} variant={badge.variant}>{badge.label}</Badge>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BasicsStep({
  name,
  visibility,
  nameError,
  onNameChange,
  onVisibilityChange,
}: {
  name: string;
  visibility: RepositoryVisibility;
  nameError?: string;
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
        {nameError && <span className="text-xs font-medium text-destructive-ink">{nameError}</span>}
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

function ConfigStep({
  plugin,
  displayName,
  fieldRenderers,
  repositoryName,
  config,
  onChange,
}: {
  plugin: RepositoryCreatePlugin;
  displayName: string;
  fieldRenderers: RepositoryCreateFieldRendererMap | undefined;
  repositoryName: string;
  config: Record<string, string>;
  onChange: (config: Record<string, string>) => void;
}) {
  const fields = repositoryConfigFieldsForStep(plugin.repositoryConfig, "config");

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">{displayName} config</h2>
        <p className="mt-1 text-sm text-muted-foreground">Configure the repository fields provided by this plugin.</p>
      </div>
      <RepositoryConfigFields
        fields={fields}
        repositoryName={repositoryName}
        values={config}
        fieldRenderers={fieldRenderers}
        onChange={onChange}
      />
    </div>
  );
}

function DependenciesStep({
  plugin,
  displayName,
  fieldRenderers,
  repositoryName,
  setup,
  onChange,
}: {
  plugin: RepositoryCreatePlugin;
  displayName: string;
  fieldRenderers: RepositoryCreateFieldRendererMap | undefined;
  repositoryName: string;
  setup: Record<string, string>;
  onChange: (setup: Record<string, string>) => void;
}) {
  const fields = repositoryConfigFieldsForStep(plugin.repositoryConfig, "setup");

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="text-base font-semibold">{displayName} setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose what this plugin should provision while creating the repository.</p>
      </div>
      <RepositoryDependencyFields
        fields={fields}
        repositoryName={repositoryName}
        values={setup}
        fieldRenderers={fieldRenderers}
        onChange={onChange}
      />
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
      <CodeBlock className="max-h-[520px] p-4" language="json" code={asJson(payload)} />
    </div>
  );
}
