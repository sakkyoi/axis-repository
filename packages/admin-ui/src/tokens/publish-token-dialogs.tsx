import { FormEvent, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../components/ui/button";
import { CopyToClipboardButton } from "../components/ui/copy-to-clipboard-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useCreatePublishToken } from "../api/hooks";
import type { PublishTokenCreateResponse, Repository } from "../api/schemas";
import {
  buildCreatePublishTokenInput,
  publishTokenSecretInputClass,
  publishTokenSecretRevealDescription,
  publishTokenSecretRevealItems,
  publishTokenSecretUnsavedDialogClasses,
  publishTokenSecretUnsavedPromptContent,
  repositoryDisplayLabel,
  shouldBlockTokenSecretRevealClose,
  type PublishTokenExpirationMode,
  type PublishTokenExpirationState,
  type PublishTokenPermissionState,
} from "./publish-token-form-model";
import { getPublishTokenScopeExtension } from "../repositories/plugins/repository-ui-plugins";
import { ErrorState, formatDate } from "../pages/shared";
import { useErrorToast } from "../components/ui/toast";
import { SkeletonRows } from "../components/ui/skeleton";

export function CreateTokenDialog({
  repositories,
  repositoriesLoading,
}: {
  repositories: Repository[];
  repositoriesLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<PublishTokenCreateResponse>();
  const [name, setName] = useState("");
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<PublishTokenPermissionState>({ read: false, publish: true });
  const [expiration, setExpiration] = useState<PublishTokenExpirationState>({ mode: "never", customDateTime: "" });
  const [scopeError, setScopeError] = useState("");
  const createToken = useCreatePublishToken();
  useErrorToast("Publish token not created", createToken.error);
  const publishTokenScopeExtensions = [
    ...new Map(
      repositories
        .map((repository) => [repository.ecosystem, getPublishTokenScopeExtension(repository.ecosystem)] as const)
        .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof getPublishTokenScopeExtension>>] =>
          Boolean(entry[1])),
    ).values(),
  ];

  function toggleRepository(repositoryName: string, selected: boolean) {
    setSelectedRepositories((current) =>
      selected
        ? [...current, repositoryName]
        : current.filter((name) => name !== repositoryName),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missingScopes = publishTokenScopeExtensions.flatMap((extension) =>
      extension.missingRequiredScopes({
        repositories,
        selectedRepositories,
        permissions,
      }),
    );
    if (!name.trim()) {
      setScopeError("Token name is required");
      return;
    }
    if (selectedRepositories.length === 0) {
      setScopeError("Select at least one repository");
      return;
    }
    if (!permissions.read && !permissions.publish) {
      setScopeError("Select at least one permission");
      return;
    }
    if (missingScopes.length > 0) {
      setScopeError(`Selected repositories need setup before publish tokens can be created: ${missingScopes.join(", ")}`);
      return;
    }

    const result = await createToken.mutateAsync(buildCreatePublishTokenInput({
      name,
      repositories,
      permissions,
      selectedRepositories,
      expiration,
      scopeExtensions: publishTokenScopeExtensions,
    }));
    setCreatedToken(result);
    setOpen(false);
    setScopeError("");
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setScopeError("");
          }
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create token
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create publish token</DialogTitle>
            <DialogDescription>The generated secret is shown once after creation.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-3" onSubmit={submit}>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Name</span>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="github-actions" required />
            </label>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Repositories</span>
              {repositoriesLoading && <SkeletonRows rows={3} columns={["w-40"]} className="p-0" />}
              {!repositoriesLoading && repositories.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  No repositories are available.
                </div>
              )}
              {repositories.length > 0 && (
                <div className="grid max-h-48 gap-2 overflow-auto rounded-md border border-border p-2">
                  {repositories.map((repository) => (
                    <label key={repository.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={selectedRepositories.includes(repository.name)}
                        onChange={(event) => toggleRepository(repository.name, event.target.checked)}
                      />
                      {repositoryDisplayLabel(repository)}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Permissions</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={permissions.publish}
                  onChange={(event) => setPermissions((current) => ({ ...current, publish: event.target.checked }))}
                />
                publish
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={permissions.read}
                  onChange={(event) => setPermissions((current) => ({ ...current, read: event.target.checked }))}
                />
                read
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Expiration</span>
              <Select
                value={expiration.mode}
                onValueChange={(value) =>
                  setExpiration((current) => ({ ...current, mode: value as PublishTokenExpirationMode }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="never">Never</SelectItem>
                  <SelectItem value="1h">1 hour</SelectItem>
                  <SelectItem value="1d">1 day</SelectItem>
                  <SelectItem value="7d">7 days</SelectItem>
                  <SelectItem value="30d">30 days</SelectItem>
                  <SelectItem value="custom">Custom date/time</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {expiration.mode === "custom" && (
              <label className="grid gap-2">
                <span className="text-sm font-medium">Custom expiration</span>
                <Input
                  type="datetime-local"
                  value={expiration.customDateTime}
                  onChange={(event) =>
                    setExpiration((current) => ({ ...current, customDateTime: event.target.value }))}
                  required
                />
              </label>
            )}
            <Button type="submit" disabled={createToken.isPending}>Create</Button>
          </form>
          {scopeError && <ErrorState error={scopeError} />}
        </DialogContent>
      </Dialog>
      <TokenCreatedDialog
        result={createdToken}
        onClose={() => setCreatedToken(undefined)}
      />
    </>
  );
}

export function TokenCreatedDialog({
  result,
  onClose,
}: {
  result: PublishTokenCreateResponse | undefined;
  onClose: () => void;
}) {
  const [secretCopied, setSecretCopied] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const items = result ? publishTokenSecretRevealItems(result.token) : [];
  const unsavedPrompt = publishTokenSecretUnsavedPromptContent();
  const unsavedDialogClasses = publishTokenSecretUnsavedDialogClasses();
  const shouldBlockClose = shouldBlockTokenSecretRevealClose({
    hasSecret: Boolean(result?.secret),
    copied: secretCopied,
  });

  useEffect(() => {
    setSecretCopied(false);
    setConfirmCloseOpen(false);
  }, [result?.secret]);

  useEffect(() => {
    if (!shouldBlockClose) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [shouldBlockClose]);

  function requestClose() {
    if (shouldBlockClose) {
      setConfirmCloseOpen(true);
      return;
    }
    onClose();
  }

  function closeAnyway() {
    setConfirmCloseOpen(false);
    onClose();
  }

  return (
    <>
      <Dialog open={Boolean(result)} onOpenChange={(open) => {
        if (!open) requestClose();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token created</DialogTitle>
            <DialogDescription>{publishTokenSecretRevealDescription()}</DialogDescription>
          </DialogHeader>
          {result && (
            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-medium">Token secret</span>
                <div className="flex min-w-0 gap-2">
                  <Input
                    className={publishTokenSecretInputClass()}
                    value={result.secret}
                    readOnly
                  />
                  <CopyToClipboardButton
                    text={result.secret}
                    label="Copy"
                    copiedLabel="Copied"
                    variant="outline"
                    className="shrink-0"
                    onCopied={() => setSecretCopied(true)}
                  />
                </div>
              </label>
              <div className="grid gap-2 rounded-md border border-border bg-background/40 p-3">
                {items.map(([label, value]) => (
                  <div key={label} className="grid gap-1">
                    <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
                    <span className="break-all text-sm">
                      {label === "Expires" && value !== "never" ? formatDate(value) : value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent className={unsavedDialogClasses.content} overlayClassName={unsavedDialogClasses.overlay}>
          <DialogHeader>
            <DialogTitle>{unsavedPrompt.title}</DialogTitle>
            <DialogDescription>{unsavedPrompt.description}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmCloseOpen(false)}>
              {unsavedPrompt.cancelLabel}
            </Button>
            <Button type="button" variant="destructive" onClick={closeAnyway}>
              {unsavedPrompt.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
