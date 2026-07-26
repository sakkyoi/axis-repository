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
          <KeyRound className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Signing key setup</h3>
        </div>
        <Tabs value={mode} onValueChange={(nextMode) => update({ signingKeyMode: nextMode })}>
          <TabsList>
            <TabsTrigger value="generate">Generate</TabsTrigger>
            <TabsTrigger value="import">Import</TabsTrigger>
            <TabsTrigger value="existing">Existing</TabsTrigger>
          </TabsList>
          <TabsContent value="generate">
            <div className="grid gap-3">
              <Input
                value={values.signingKeyName ?? ""}
                onChange={(event) => update({ signingKeyName: event.target.value })}
                placeholder="release"
                required
              />
              <Input
                value={values.signingKeyUserIdName ?? ""}
                onChange={(event) => update({ signingKeyUserIdName: event.target.value })}
                placeholder="Axis Repository"
                required
              />
              <Input
                value={values.signingKeyUserIdEmail ?? ""}
                onChange={(event) => update({ signingKeyUserIdEmail: event.target.value })}
                type="email"
                placeholder="axis@example.local"
                required
              />
            </div>
          </TabsContent>
          <TabsContent value="import">
            <div className="grid gap-3">
              <Input
                value={values.signingKeyName ?? ""}
                onChange={(event) => update({ signingKeyName: event.target.value })}
                placeholder="release"
                required
              />
              <Textarea
                value={values.signingKeyPrivateKeyArmored ?? ""}
                onChange={(event) => update({ signingKeyPrivateKeyArmored: event.target.value })}
                placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----"
                required
              />
              <Input
                value={values.signingKeyPassphrase ?? ""}
                onChange={(event) => update({ signingKeyPassphrase: event.target.value })}
                type="password"
                placeholder="Passphrase"
                required
              />
            </div>
          </TabsContent>
          <TabsContent value="existing">
            {activeKeys.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
                No active signing key is scoped to {repositoryName}. Generate or import one during creation instead.
              </div>
            ) : (
              <Select
                value={values.signingKeyExistingId ?? ""}
                onValueChange={(signingKeyId) => update({ signingKeyExistingId: signingKeyId })}
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
            )}
          </TabsContent>
        </Tabs>
      </div>
      {signingKeys.length > 0 && <SigningKeySummary signingKeys={signingKeys} />}
      {signingKeysQuery.isError && <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />}
    </>
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
