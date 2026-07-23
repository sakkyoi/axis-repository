import { type FormEvent, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import {
  useAptSigningKeys,
  useGenerateAptSigningKey,
  useImportAptSigningKey,
} from "./api";
import type { SigningKey } from "../../api/schemas";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";
import { ErrorState, formatDate } from "../../pages/shared";
import type { RepositoryCreateFieldRendererProps } from "../../repository-ui-plugin-types";
import { activeSigningKeys } from "./forms";

export function AptSigningKeyDependencyField({
  field,
  repositoryName,
  value,
  onChange,
}: RepositoryCreateFieldRendererProps) {
  const signingKeysQuery = useAptSigningKeys(repositoryName, Boolean(repositoryName));
  const signingKeys = signingKeysQuery.data ?? [];
  const activeKeys = activeSigningKeys(signingKeys);

  if (!repositoryName) {
    return (
      <ErrorState
        title="Repository name required"
        error={new Error("Go back and enter a repository name before configuring dependencies.")}
      />
    );
  }

  return (
    <>
      <label className="grid gap-2">
        <span className="text-sm font-medium">{field.label}</span>
        {field.description && <span className="text-xs text-muted-foreground">{field.description}</span>}
        {activeKeys.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            No active signing key is scoped to {repositoryName}. Generate or import one below.
          </div>
        ) : (
          <Select value={value} onValueChange={onChange}>
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
      </label>
      <InlineAptSigningKeyForm repositoryName={repositoryName} onCreated={(key) => onChange(key.id)} />
      {signingKeys.length > 0 && <SigningKeySummary signingKeys={signingKeys} />}
      {signingKeysQuery.isError && <ErrorState title="Signing keys unavailable" error={signingKeysQuery.error} />}
    </>
  );
}

function InlineAptSigningKeyForm({
  repositoryName,
  onCreated,
}: {
  repositoryName: string;
  onCreated: (key: SigningKey) => void;
}) {
  const generateKey = useGenerateAptSigningKey();
  const importKey = useImportAptSigningKey();
  const [error, setError] = useState("");

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const key = await generateKey.mutateAsync({
        repositoryName,
        input: {
          name: String(form.get("name") ?? ""),
          userIdName: String(form.get("userIdName") ?? ""),
          userIdEmail: String(form.get("userIdEmail") ?? ""),
        },
      });
      setError("");
      onCreated(key);
      formElement.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Signing key could not be generated");
    }
  }

  async function importSigningKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const key = await importKey.mutateAsync({
        repositoryName,
        input: {
          name: String(form.get("name") ?? ""),
          privateKeyArmored: String(form.get("privateKeyArmored") ?? ""),
          passphrase: String(form.get("passphrase") ?? ""),
        },
      });
      setError("");
      onCreated(key);
      formElement.reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Signing key could not be imported");
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="mb-3 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Create signing key</h3>
      </div>
      <Tabs defaultValue="generate">
        <TabsList>
          <TabsTrigger value="generate">Generate</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
        </TabsList>
        <TabsContent value="generate">
          <form className="grid gap-3" onSubmit={generate}>
            <Input name="name" placeholder="release" required />
            <Input name="userIdName" placeholder="Axis Repository" required />
            <Input name="userIdEmail" type="email" placeholder="axis@example.local" required />
            <Button type="submit" disabled={generateKey.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Generate key
            </Button>
          </form>
        </TabsContent>
        <TabsContent value="import">
          <form className="grid gap-3" onSubmit={importSigningKey}>
            <Input name="name" placeholder="release" required />
            <Textarea name="privateKeyArmored" placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" required />
            <Input name="passphrase" type="password" placeholder="Passphrase" required />
            <Button type="submit" disabled={importKey.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Import key
            </Button>
          </form>
        </TabsContent>
      </Tabs>
      {(error || generateKey.isError || importKey.isError) && (
        <div className="mt-3">
          <ErrorState error={error || generateKey.error || importKey.error} />
        </div>
      )}
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
