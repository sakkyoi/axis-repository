import { KeyRound } from "lucide-react";
import { useAptSigningKeys } from "./api";
import {
  ErrorState,
  formatDate,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  type RepositoryCreateFieldRendererProps,
  type SigningKey,
} from "@axis-repository/admin-ui/plugin-ui";
import { activeSigningKeys, signingKeySetupPanelClass } from "./forms";

export function AptSigningKeySetupField({
  field,
  repositoryName,
  values,
  onValuesChange,
}: RepositoryCreateFieldRendererProps) {
  const signingKeysQuery = useAptSigningKeys(repositoryName, Boolean(repositoryName));
  const signingKeys = signingKeysQuery.data ?? [];
  const activeKeys = activeSigningKeys(signingKeys);
  const policyMode = values.signingMode || (field.name === "signingPolicy" ? "upstream" : "axis");
  const axisLabel = field.name === "signingPolicy" ? "Re-sign with Axis" : "Sign with Axis";
  const mode = values.signingKeyMode || "generate";

  function update(patch: Record<string, string>) {
    onValuesChange({ ...values, ...patch });
  }

  if (!repositoryName) {
    return (
      <ErrorState
        title="Repository name required"
        error={new Error("Go back and enter a repository name before configuring setup.")}
      />
    );
  }

  return (
    <>
      <div className="grid gap-2">
        <span className="text-sm font-medium">{field.label}</span>
        {field.description && <span className="text-xs text-muted-foreground">{field.description}</span>}
      </div>
      <div className={signingKeySetupPanelClass()}>
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary-ink" />
          <h3 className="text-sm font-semibold">Signing policy</h3>
        </div>
        <Tabs value={policyMode} onValueChange={(nextMode) => update({ signingMode: nextMode })}>
          <TabsList>
            {field.name === "signingPolicy" && <TabsTrigger value="upstream">Use upstream</TabsTrigger>}
            <TabsTrigger value="axis">{axisLabel}</TabsTrigger>
            <TabsTrigger value="unsigned">Unsigned</TabsTrigger>
          </TabsList>
          {field.name === "signingPolicy" && (
            <TabsContent value="upstream">
              <div className="grid gap-2">
                <Input
                  value={values.upstreamKeyUrl ?? ""}
                  onChange={(event) => update({ upstreamKeyUrl: event.target.value })}
                  placeholder="https://download.example/key.gpg"
                />
                <span className="text-xs text-muted-foreground">
                  Optional public key URL exposed to APT clients through this repository.
                </span>
              </div>
            </TabsContent>
          )}
          <TabsContent value="unsigned">
            <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              This repository will publish Release metadata without InRelease or Release.gpg.
            </div>
          </TabsContent>
          <TabsContent value="axis">
            <div className="grid gap-3 rounded-md border border-border/80 bg-background/60 p-3">
              <div className="grid gap-1">
                <span className="text-sm font-medium">Signing key</span>
                <span className="text-xs text-muted-foreground">
                  Choose an Axis key source for this repository.
                </span>
              </div>
              <label className="grid gap-2">
                <span className="text-xs font-medium uppercase text-muted-foreground">Key source</span>
                <Select value={mode} onValueChange={(nextMode) => update({ signingKeyMode: nextMode })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select key source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="generate">Generate new key</SelectItem>
                    <SelectItem value="import">Import private key</SelectItem>
                    <SelectItem value="existing">Use existing key</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <SigningKeySetupFields
                mode={mode}
                values={values}
                activeKeys={activeKeys}
                repositoryName={repositoryName}
                onUpdate={update}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>
      {policyMode === "axis" && signingKeys.length > 0 && <SigningKeySummary signingKeys={signingKeys} />}
      {signingKeysQuery.isError && <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />}
    </>
  );
}

function SigningKeySetupFields({
  mode,
  values,
  activeKeys,
  repositoryName,
  onUpdate,
}: {
  mode: string;
  values: Record<string, string>;
  activeKeys: SigningKey[];
  repositoryName: string;
  onUpdate: (patch: Record<string, string>) => void;
}) {
  if (mode === "import") {
    return (
      <div className="grid gap-3">
        <label className="grid gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Key name</span>
          <Input
            value={values.signingKeyName ?? ""}
            onChange={(event) => onUpdate({ signingKeyName: event.target.value })}
            placeholder="release"
            required
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Private key</span>
          <Textarea
            value={values.signingKeyPrivateKeyArmored ?? ""}
            onChange={(event) => onUpdate({ signingKeyPrivateKeyArmored: event.target.value })}
            placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
            required
          />
        </label>
        <label className="grid gap-2">
          <span className="text-xs font-medium uppercase text-muted-foreground">Passphrase</span>
          <Input
            value={values.signingKeyPassphrase ?? ""}
            onChange={(event) => onUpdate({ signingKeyPassphrase: event.target.value })}
            type="password"
            placeholder="Passphrase"
            required
          />
        </label>
      </div>
    );
  }

  if (mode === "existing") {
    return activeKeys.length === 0 ? (
      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        No active signing key is scoped to {repositoryName}. Generate or import one during creation instead.
      </div>
    ) : (
      <label className="grid gap-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">Existing key</span>
        <Select
          value={values.signingKeyExistingId ?? ""}
          onValueChange={(signingKeyId) => onUpdate({ signingKeyExistingId: signingKeyId })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select signing key" />
          </SelectTrigger>
          <SelectContent>
            {activeKeys.map((key) => (
              <SelectItem key={key.id} value={key.id}>{key.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    );
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">Key name</span>
        <Input
          value={values.signingKeyName ?? ""}
          onChange={(event) => onUpdate({ signingKeyName: event.target.value })}
          placeholder="release"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">User ID name</span>
        <Input
          value={values.signingKeyUserIdName ?? ""}
          onChange={(event) => onUpdate({ signingKeyUserIdName: event.target.value })}
          placeholder="Axis Repository"
          required
        />
      </label>
      <label className="grid gap-2">
        <span className="text-xs font-medium uppercase text-muted-foreground">User ID email</span>
        <Input
          value={values.signingKeyUserIdEmail ?? ""}
          onChange={(event) => onUpdate({ signingKeyUserIdEmail: event.target.value })}
          type="email"
          placeholder="axis@example.local"
          required
        />
      </label>
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
