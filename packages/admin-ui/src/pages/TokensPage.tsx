import { FormEvent, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DestructiveActionDialog } from "../components/ui/destructive-action-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useCreatePublishToken, usePublishTokens, useRepositories, useRevokePublishToken } from "../api/hooks";
import type { PublishToken, Repository } from "../api/schemas";
import {
  buildCreatePublishTokenInput,
  initialPublishTokenSelection,
  publishTokenDetailActionRowClass,
  publishTokenDetailBodyClass,
  publishTokenRawMetadataClass,
  publishTokenRawMetadataContainerClass,
  publishTokenRowStateClass,
  publishTokenSummaryGridClass,
  publishTokenSummaryItemClass,
  publishTokenSummaryItems,
  publishTokenSummaryValueClass,
  repositoryDisplayLabel,
  revokePublishTokenDialogContent,
  type PublishTokenExpirationMode,
  type PublishTokenExpirationState,
  type PublishTokenPermissionState,
} from "../tokens/publish-token-form-model";
import { getPublishTokenScopeExtension } from "../repositories/plugins/repository-ui-plugins";
import { asJson, EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

export function TokensPage() {
  const tokens = usePublishTokens();
  const repositories = useRepositories();
  const [selectedName, setSelectedName] = useState<string | undefined>(() => initialPublishTokenSelection([]));
  const [pendingRevokeName, setPendingRevokeName] = useState<string>();
  const selected = tokens.data?.find((token) => token.name === selectedName);
  const revoke = useRevokePublishToken();
  const revokeDialogContent = pendingRevokeName ? revokePublishTokenDialogContent(pendingRevokeName) : undefined;

  function closeRevokeDialog() {
    if (revoke.isPending) return;
    setPendingRevokeName(undefined);
    revoke.reset();
  }

  function confirmRevokeToken() {
    if (!pendingRevokeName) return;
    revoke.mutate(pendingRevokeName, {
      onSuccess: () => setPendingRevokeName(undefined),
    });
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <PageHeader
        title="Publish Tokens"
        description="Create scoped automation tokens and revoke them when they are no longer needed."
        action={<CreateTokenDialog repositories={repositories.data ?? []} repositoriesLoading={repositories.isLoading} />}
      />
      <div className="min-h-0">
        {repositories.isError && <ErrorState title="Repositories unavailable" error={repositories.error} />}
        {tokens.isError && <ErrorState error={tokens.error} />}
        {tokens.isLoading && <div className="text-sm text-muted-foreground">Loading publish tokens...</div>}
        {tokens.data && (
          <div className="grid h-full min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
            <div className="min-h-0 min-w-0 overflow-auto rounded-lg border border-border bg-panel">
              {tokens.data.length === 0 ? (
                <div className="p-4">
                  <EmptyState message="No publish tokens have been created." />
                </div>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 bg-muted text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Permissions</th>
                      <th className="px-3 py-2">Repositories</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.data.map((token) => (
                      <tr
                        key={token.id}
                        className={`cursor-pointer border-t border-border ${publishTokenRowStateClass(token.name, selectedName)}`}
                        onClick={() => setSelectedName(token.name)}
                      >
                        <td className="px-3 py-2 font-medium">{token.name}</td>
                        <td className="px-3 py-2">{token.permissions.join(", ")}</td>
                        <td className="px-3 py-2">{token.repositories.join(", ")}</td>
                        <td className="px-3 py-2">
                          <Badge variant={token.revokedAt ? "destructive" : "success"}>
                            {token.revokedAt ? "revoked" : "active"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {selected ? (
              <PublishTokenDetail
                token={selected}
                revokePending={revoke.isPending}
                onRevoke={() => setPendingRevokeName(selected.name)}
              />
            ) : <PublishTokenDetailEmptyState />}
          </div>
        )}
      </div>
      {revokeDialogContent && (
        <DestructiveActionDialog
          open={Boolean(pendingRevokeName)}
          title={revokeDialogContent.title}
          description={revokeDialogContent.description}
          confirmLabel={revokeDialogContent.confirmLabel}
          pendingLabel={revokeDialogContent.pendingLabel}
          confirmationText={revokeDialogContent.confirmationText}
          pending={revoke.isPending}
          error={revoke.isError ? revoke.error : undefined}
          onOpenChange={(open) => {
            if (!open) {
              closeRevokeDialog();
            }
          }}
          onConfirm={confirmRevokeToken}
        />
      )}
    </section>
  );
}

function PublishTokenDetailEmptyState() {
  return (
    <aside className="grid min-h-0 min-w-0 place-items-center rounded-lg border border-dashed border-border bg-panel p-6">
      <div className="max-w-xs text-center">
        <h2 className="text-sm font-semibold">Select a token</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose an item from the token list to inspect its scopes.
        </p>
      </div>
    </aside>
  );
}

function PublishTokenDetail({
  token,
  revokePending,
  onRevoke,
}: {
  token: PublishToken;
  revokePending: boolean;
  onRevoke: () => void;
}) {
  const summaryItems = publishTokenSummaryItems(token);
  return (
    <aside className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-panel">
      <div className="sticky top-0 z-10 border-b border-border bg-panel p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{token.name}</h2>
            <p className="text-sm text-muted-foreground">Created {formatDate(token.createdAt)}</p>
          </div>
          <Badge className="shrink-0" variant={token.revokedAt ? "destructive" : "success"}>
            {token.revokedAt ? "revoked" : "active"}
          </Badge>
        </div>
      </div>
      <div className={publishTokenDetailBodyClass()}>
        <div className={publishTokenDetailActionRowClass()}>
          <Button
            variant="destructive"
            disabled={Boolean(token.revokedAt) || revokePending}
            onClick={onRevoke}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Revoke token
          </Button>
        </div>
        <div className={publishTokenSummaryGridClass()}>
          {summaryItems.map(([label, value]) => (
            <div key={label} className={publishTokenSummaryItemClass()}>
              <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
              <span className={publishTokenSummaryValueClass()}>
                {label === "Created" || label === "Expires" && value !== "never" ? formatDate(value) : value}
              </span>
            </div>
          ))}
        </div>
        <details className={publishTokenRawMetadataContainerClass()}>
          <summary className="cursor-pointer text-sm font-medium">Raw token metadata</summary>
          <pre className={publishTokenRawMetadataClass()}>{asJson(token)}</pre>
        </details>
      </div>
    </aside>
  );
}

function CreateTokenDialog({
  repositories,
  repositoriesLoading,
}: {
  repositories: Repository[];
  repositoriesLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<PublishTokenPermissionState>({ read: false, publish: true });
  const [expiration, setExpiration] = useState<PublishTokenExpirationState>({ mode: "never", customDateTime: "" });
  const [scopeError, setScopeError] = useState("");
  const createToken = useCreatePublishToken();
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
    setSecret(result.secret);
    setScopeError("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSecret("");
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
            {repositoriesLoading && <div className="text-sm text-muted-foreground">Loading repositories...</div>}
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
        {secret && (
          <div className="grid gap-2 rounded-md border border-warning/40 bg-warning/15 p-3 text-warning-foreground">
            <div className="text-sm font-medium">Token secret</div>
            <code className="break-all text-sm">{secret}</code>
          </div>
        )}
        {createToken.isError && <ErrorState error={createToken.error} />}
      </DialogContent>
    </Dialog>
  );
}
