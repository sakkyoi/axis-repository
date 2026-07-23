import { FormEvent, useMemo, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { useAptSigningKeys, useCreatePublishToken, usePublishTokens, useRepositories, useRevokePublishToken } from "../api/hooks";
import type { Repository } from "../api/schemas";
import {
  activeSigningKeysForRepository,
  buildCreatePublishTokenInput,
  publishTokenNeedsSigningKeySelection,
  repositoryDisplayLabel,
  tokenScopeSummary,
  type PublishTokenPermissionState,
} from "../publish-token-form-model";
import { asJson, EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

export function TokensPage() {
  const tokens = usePublishTokens();
  const repositories = useRepositories();
  const [selectedName, setSelectedName] = useState<string>();
  const selected = tokens.data?.find((token) => token.name === selectedName) ?? tokens.data?.[0];
  const revoke = useRevokePublishToken();
  const selectedSummary = selected ? tokenScopeSummary(selected) : undefined;

  return (
    <section>
      <PageHeader
        title="Publish Tokens"
        description="Create scoped automation tokens and revoke them when they are no longer needed."
        action={<CreateTokenDialog repositories={repositories.data ?? []} repositoriesLoading={repositories.isLoading} />}
      />
      {repositories.isError && <ErrorState title="Repositories unavailable" error={repositories.error} />}
      {tokens.isError && <ErrorState error={tokens.error} />}
      {tokens.isLoading && <div className="text-sm text-muted-foreground">Loading publish tokens...</div>}
      {tokens.data && tokens.data.length === 0 && <EmptyState message="No publish tokens have been created." />}
      {tokens.data && tokens.data.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-5">
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
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
                    className="cursor-pointer border-t border-border hover:bg-muted/60"
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
          </div>
          {selected && (
            <aside className="grid content-start gap-4 rounded-lg border border-border bg-panel p-4">
              <div>
                <h2 className="text-base font-semibold">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">Created {formatDate(selected.createdAt)}</p>
              </div>
              {selectedSummary && (
                <dl className="grid gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Permissions</dt>
                    <dd className="mt-1">{selectedSummary.permissions}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Repositories</dt>
                    <dd className="mt-1">{selectedSummary.repositories}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Signing key scopes</dt>
                    <dd className="mt-1">{selectedSummary.signingKeys}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase text-muted-foreground">Expires</dt>
                    <dd className="mt-1">{selected.expiresAt ? formatDate(selected.expiresAt) : "never"}</dd>
                  </div>
                </dl>
              )}
              <details>
                <summary className="cursor-pointer text-sm font-medium">Raw token metadata</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{asJson(selected)}</pre>
              </details>
              <Button
                variant="destructive"
                disabled={Boolean(selected.revokedAt) || revoke.isPending}
                onClick={() => revoke.mutate(selected.name)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Revoke token
              </Button>
              {revoke.isError && <ErrorState error={revoke.error} />}
            </aside>
          )}
        </div>
      )}
    </section>
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
  const [signingKeySelections, setSigningKeySelections] = useState<Record<string, string>>({});
  const [scopeError, setScopeError] = useState("");
  const createToken = useCreatePublishToken();
  const selectedAptRepositories = useMemo(
    () => repositories.filter((repository) =>
      selectedRepositories.includes(repository.name) && repository.ecosystem === "apt" && permissions.publish,
    ),
    [permissions.publish, repositories, selectedRepositories],
  );

  function toggleRepository(repositoryName: string, selected: boolean) {
    setSelectedRepositories((current) =>
      selected
        ? [...current, repositoryName]
        : current.filter((name) => name !== repositoryName),
    );
    if (!selected) {
      setSigningKeySelections((current) => {
        const { [repositoryName]: _removed, ...rest } = current;
        return rest;
      });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const missingSigningKeys = publishTokenNeedsSigningKeySelection({
      repositories,
      selectedRepositories,
      permissions,
      signingKeySelections,
    });
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
    if (missingSigningKeys.length > 0) {
      setScopeError(`Select signing keys for: ${missingSigningKeys.join(", ")}`);
      return;
    }

    const result = await createToken.mutateAsync(buildCreatePublishTokenInput({
      name,
      permissions,
      selectedRepositories,
      signingKeySelections,
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
          {selectedAptRepositories.length > 0 && (
            <div className="grid gap-3 rounded-md border border-border p-3">
              <div>
                <h3 className="text-sm font-semibold">APT signing key scopes</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  APT publish tokens must include the signing key used by each selected repository.
                </p>
              </div>
              {selectedAptRepositories.map((repository) => (
                <AptSigningKeyScopeField
                  key={repository.name}
                  repositoryName={repository.name}
                  value={signingKeySelections[repository.name] ?? ""}
                  onChange={(signingKeyId) =>
                    setSigningKeySelections((current) => ({ ...current, [repository.name]: signingKeyId }))}
                />
              ))}
            </div>
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

function AptSigningKeyScopeField({
  repositoryName,
  value,
  onChange,
}: {
  repositoryName: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const signingKeys = useAptSigningKeys(repositoryName);
  const activeKeys = activeSigningKeysForRepository(signingKeys.data ?? [], repositoryName);

  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{repositoryName} signing key scope</span>
      {signingKeys.isLoading && <span className="text-sm text-muted-foreground">Loading signing keys...</span>}
      {!signingKeys.isLoading && activeKeys.length === 0 && (
        <span className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          No active signing key is available for this repository.
        </span>
      )}
      {activeKeys.length > 0 && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Select signing key" />
          </SelectTrigger>
          <SelectContent>
            {activeKeys.map((key) => (
              <SelectItem key={key.id} value={key.id}>{key.name} ({key.keyId})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {signingKeys.isError && <ErrorState title="Signing keys unavailable" error={signingKeys.error} />}
    </label>
  );
}
