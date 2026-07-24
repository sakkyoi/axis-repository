import { type FormEvent, useState } from "react";
import { KeyRound, Plus, RotateCcw } from "lucide-react";
import {
  asJson,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  formatDate,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  type SigningKey,
} from "@axis-repository/admin-ui/plugin-ui";
import {
  useGenerateAptSigningKey,
  useImportAptSigningKey,
  useRevokeAptSigningKey,
} from "./api";

type CreateMode = "generate" | "import";

export function AptSigningKeyDialog({ repositoryName, disabled = false }: { repositoryName: string; disabled?: boolean }) {
  const generateKey = useGenerateAptSigningKey();
  const importKey = useImportAptSigningKey();
  const [mode, setMode] = useState<CreateMode>("generate");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "generate") {
        await generateKey.mutateAsync({
          repositoryName,
          input: {
            name: String(form.get("name") ?? ""),
            userIdName: String(form.get("userIdName") ?? ""),
            userIdEmail: String(form.get("userIdEmail") ?? ""),
          },
        });
      } else {
        await importKey.mutateAsync({
          repositoryName,
          input: {
            name: String(form.get("name") ?? ""),
            privateKeyArmored: String(form.get("privateKeyArmored") ?? ""),
            passphrase: String(form.get("passphrase") ?? ""),
          },
        });
      }
      setError("");
      event.currentTarget.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Signing key could not be saved");
    }
  }

  const isPending = generateKey.isPending || importKey.isPending;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <KeyRound className="mr-2 h-4 w-4" />
          APT signing key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>APT signing key</DialogTitle>
          <DialogDescription>Generate or import an OpenPGP key for {repositoryName} metadata signing.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className="text-sm font-medium">Mode</span>
            <Select value={mode} onValueChange={(value) => setMode(value as CreateMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generate">Generate</SelectItem>
                <SelectItem value="import">Import</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Input name="name" placeholder="debian-prod" required />
          {mode === "generate" ? (
            <>
              <Input name="userIdName" placeholder="Axis Repository" required />
              <Input name="userIdEmail" type="email" placeholder="axis@example.local" required />
            </>
          ) : (
            <>
              <Textarea name="privateKeyArmored" placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" required />
              <Input name="passphrase" type="password" placeholder="Passphrase" required />
            </>
          )}
          <Button type="submit" disabled={isPending}>
            <Plus className="mr-2 h-4 w-4" />
            {mode === "generate" ? "Generate key" : "Import key"}
          </Button>
        </form>
        {(error || generateKey.isError || importKey.isError) && (
          <ErrorState error={error || generateKey.error || importKey.error} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AptSigningKeyList({ repositoryName, signingKeys }: { repositoryName: string; signingKeys: SigningKey[] }) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = signingKeys.find((key) => key.id === selectedId) ?? signingKeys[0];
  const revoke = useRevokeAptSigningKey();

  if (signingKeys.length === 0) {
    return <EmptyState message="No APT signing keys have been added." />;
  }

  return (
    <div className="grid gap-4">
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
            {signingKeys.map((key) => (
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
        <div className="grid gap-3 rounded-lg border border-border bg-panel p-4">
          <div>
            <h3 className="text-sm font-semibold">{selected.name}</h3>
            <p className="text-xs text-muted-foreground">{selected.fingerprint}</p>
          </div>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{asJson(selected)}</pre>
          <Button
            variant="destructive"
            disabled={Boolean(selected.revokedAt) || revoke.isPending}
            onClick={() => revoke.mutate({ repositoryName, id: selected.id })}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Revoke key
          </Button>
          {revoke.isError && <ErrorState error={revoke.error} />}
        </div>
      )}
    </div>
  );
}
