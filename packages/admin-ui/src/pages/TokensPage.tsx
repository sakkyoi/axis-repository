import { FormEvent, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useCreatePublishToken, usePublishTokens, useRevokePublishToken } from "../api/hooks";
import { asJson, EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

export function TokensPage() {
  const tokens = usePublishTokens();
  const [selectedName, setSelectedName] = useState<string>();
  const selected = tokens.data?.find((token) => token.name === selectedName) ?? tokens.data?.[0];
  const revoke = useRevokePublishToken();

  return (
    <section>
      <PageHeader
        title="Publish Tokens"
        description="Create scoped automation tokens and revoke them when they are no longer needed."
        action={<CreateTokenDialog />}
      />
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
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{asJson(selected)}</pre>
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

function CreateTokenDialog() {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [scopeError, setScopeError] = useState("");
  const createToken = useCreatePublishToken();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const repositories = String(form.get("repositories") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const permissions = String(form.get("permissions") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const signingKeyIds = String(form.get("signingKeyIds") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    let ecosystemScopes: Record<string, unknown>;
    try {
      ecosystemScopes = JSON.parse(String(form.get("ecosystemScopes") || "{}")) as Record<string, unknown>;
      setScopeError("");
    } catch (error) {
      setScopeError(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    const result = await createToken.mutateAsync({
      name: String(form.get("name") ?? ""),
      repositories,
      permissions,
      ecosystemScopes,
      ...(signingKeyIds.length ? { signingKeyIds } : {}),
    });
    setSecret(result.secret);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
          <Input name="name" placeholder="github-actions" required />
          <Input name="repositories" placeholder="repositories: debian-internal" required />
          <Input name="permissions" placeholder="permissions: read,publish" required />
          <Input name="signingKeyIds" placeholder="signing key ids, optional" />
          <Textarea name="ecosystemScopes" defaultValue="{}" />
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
