import { type FormEvent, useState } from "react";
import { KeyRound, Plus, RotateCcw } from "lucide-react";
import {
  asJson,
  CodeBlock,
  Badge,
  Button,
  DestructiveActionDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  useErrorToast,
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
import {
  revokeAptSigningKeyDialogContent,
  submitAptSigningKeyForm,
  type AptSigningKeyCreateMode,
} from "./signing-keys-model";

export function AptSigningKeyDialog({
  repositoryName,
  disabled = false,
  onSetPrimarySigningKey,
}: {
  repositoryName: string;
  disabled?: boolean;
  onSetPrimarySigningKey?: (key: SigningKey) => Promise<void>;
}) {
  const generateKey = useGenerateAptSigningKey();
  const importKey = useImportAptSigningKey();
  useErrorToast("Signing key not added", generateKey.error || importKey.error);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AptSigningKeyCreateMode>("generate");
  const [useAsPrimary, setUseAsPrimary] = useState(true);
  const [error, setError] = useState("");

  function changeOpen(nextOpen: boolean) {
    if (nextOpen) {
      setUseAsPrimary(true);
      setError("");
    }
    setOpen(nextOpen);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    await submitAptSigningKeyForm({
      mode,
      repositoryName,
      formData,
      formElement,
      useAsPrimary,
      generateKey: generateKey.mutateAsync,
      importKey: importKey.mutateAsync,
      ...(onSetPrimarySigningKey ? { setPrimarySigningKey: onSetPrimarySigningKey } : {}),
      setError,
      close: () => setOpen(false),
    });
  }

  const isPending = generateKey.isPending || importKey.isPending;

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
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
            <Select value={mode} onValueChange={(value) => setMode(value as AptSigningKeyCreateMode)}>
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
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={useAsPrimary}
              onChange={(event) => setUseAsPrimary(event.target.checked)}
            />
            Use as repository signing key
          </label>
          <Button type="submit" disabled={isPending}>
            <Plus className="mr-2 h-4 w-4" />
            {mode === "generate" ? "Generate key" : "Import key"}
          </Button>
          {Boolean(error) && <ErrorState error={error} />}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AptSigningKeyList({
  repositoryName,
  signingKeys,
  currentSigningKeyId,
}: {
  repositoryName: string;
  signingKeys: SigningKey[];
  currentSigningKeyId: string | undefined;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [pendingRevokeKey, setPendingRevokeKey] = useState<{ id: string; name: string }>();
  const selected = signingKeys.find((key) => key.id === selectedId) ?? signingKeys[0];
  const revoke = useRevokeAptSigningKey();
  const activeKeyCount = signingKeys.filter((key) => !key.revokedAt).length;
  const pendingRevokeSigningKey = pendingRevokeKey
    ? signingKeys.find((key) => key.id === pendingRevokeKey.id)
    : undefined;
  const revokeDialogContent = pendingRevokeKey ? revokeAptSigningKeyDialogContent({
    signingKeyName: pendingRevokeKey.name,
    isCurrent: pendingRevokeKey.id === currentSigningKeyId,
    isLastActive: !pendingRevokeSigningKey?.revokedAt && activeKeyCount === 1,
  }) : undefined;

  function closeRevokeDialog() {
    if (revoke.isPending) return;
    setPendingRevokeKey(undefined);
    revoke.reset();
  }

  function confirmRevokeKey() {
    if (!pendingRevokeKey) return;
    revoke.mutate({ repositoryName, id: pendingRevokeKey.id }, {
      onSuccess: () => setPendingRevokeKey(undefined),
    });
  }

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
          <CodeBlock className="max-h-64" language="json" code={asJson(selected)} />
          <Button
            variant="destructive"
            disabled={Boolean(selected.revokedAt) || revoke.isPending}
            onClick={() => setPendingRevokeKey({ id: selected.id, name: selected.name })}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Revoke key
          </Button>
        </div>
      )}
      {revokeDialogContent && (
        <DestructiveActionDialog
          open={Boolean(pendingRevokeKey)}
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
          onConfirm={confirmRevokeKey}
        />
      )}
    </div>
  );
}
