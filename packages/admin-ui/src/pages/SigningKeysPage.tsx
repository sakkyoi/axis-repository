import { FormEvent, useState } from "react";
import { Plus, RotateCcw } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { useCreateSigningKey, useRevokeSigningKey, useSigningKeys } from "../api/hooks";
import { asJson, EmptyState, ErrorState, PageHeader, formatDate } from "./shared";

export function SigningKeysPage() {
  const signingKeys = useSigningKeys();
  const [selectedId, setSelectedId] = useState<string>();
  const selected = signingKeys.data?.find((key) => key.id === selectedId) ?? signingKeys.data?.[0];
  const revoke = useRevokeSigningKey();

  return (
    <section>
      <PageHeader
        title="Signing Keys"
        description="Manage OpenPGP signing keys used by repository publishers."
        action={<CreateSigningKeyDialog />}
      />
      {signingKeys.isError && <ErrorState error={signingKeys.error} />}
      {signingKeys.isLoading && <div className="text-sm text-muted-foreground">Loading signing keys...</div>}
      {signingKeys.data && signingKeys.data.length === 0 && <EmptyState message="No signing keys have been added." />}
      {signingKeys.data && signingKeys.data.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-5">
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Key ID</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {signingKeys.data.map((key) => (
                  <tr
                    key={key.id}
                    className="cursor-pointer border-t border-border hover:bg-muted/60"
                    onClick={() => setSelectedId(key.id)}
                  >
                    <td className="px-3 py-2 font-medium">{key.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{key.keyId}</td>
                    <td className="px-3 py-2">
                      <Badge variant={key.revokedAt ? "destructive" : "success"}>
                        {key.revokedAt ? "revoked" : "active"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(key.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <aside className="grid content-start gap-4 rounded-lg border border-border bg-panel p-4">
              <div>
                <h2 className="text-base font-semibold">{selected.name}</h2>
                <p className="text-sm text-muted-foreground">{selected.fingerprint}</p>
              </div>
              <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{asJson(selected)}</pre>
              <Button
                variant="destructive"
                disabled={Boolean(selected.revokedAt) || revoke.isPending}
                onClick={() => revoke.mutate(selected.id)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Revoke key
              </Button>
              {revoke.isError && <ErrorState error={revoke.error} />}
            </aside>
          )}
        </div>
      )}
    </section>
  );
}

function CreateSigningKeyDialog() {
  const createSigningKey = useCreateSigningKey();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await createSigningKey.mutateAsync({
      name: String(form.get("name") ?? ""),
      privateKeyArmored: String(form.get("privateKeyArmored") ?? ""),
      passphrase: String(form.get("passphrase") ?? ""),
    });
    event.currentTarget.reset();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add signing key</DialogTitle>
          <DialogDescription>Private key material is sent to the admin API for encrypted storage.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <Input name="name" placeholder="debian-prod" required />
          <Textarea name="privateKeyArmored" placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" required />
          <Input name="passphrase" type="password" placeholder="Passphrase" required />
          <Button type="submit" disabled={createSigningKey.isPending}>Add key</Button>
        </form>
        {createSigningKey.isError && <ErrorState error={createSigningKey.error} />}
      </DialogContent>
    </Dialog>
  );
}
