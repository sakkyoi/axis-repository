import type { Repository, SigningKey } from "../../api/schemas";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { ErrorState } from "../../pages/shared";
import type { PublishTokenScopeComponentProps, PublishTokenScopeInput } from "../../repository-ui-plugin-types";
import { useAptSigningKeys } from "./api";

export function aptPublishTokenMissingSigningKeySelections(input: PublishTokenScopeInput): string[] {
  if (!input.permissions.publish) return [];
  const selected = new Set(input.selectedRepositories);
  return input.repositories
    .filter((repository) => selected.has(repository.name))
    .filter((repository) => repository.ecosystem === "apt")
    .filter((repository) => !input.signingKeySelections[repository.name])
    .map((repository) => repository.name);
}

export function activeSigningKeysForRepository(keys: SigningKey[], repositoryName: string): SigningKey[] {
  return keys.filter((key) => key.repositoryName === repositoryName && !key.revokedAt);
}

export function AptSigningKeyTokenScopeFields({
  repositories,
  selectedRepositories,
  permissions,
  signingKeySelections,
  onSigningKeySelectionChange,
}: PublishTokenScopeComponentProps) {
  const selectedAptRepositories = repositories.filter((repository) =>
    selectedRepositories.includes(repository.name) && repository.ecosystem === "apt" && permissions.publish,
  );

  if (selectedAptRepositories.length === 0) return null;

  return (
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
          repository={repository}
          value={signingKeySelections[repository.name] ?? ""}
          onChange={(signingKeyId) => onSigningKeySelectionChange(repository.name, signingKeyId)}
        />
      ))}
    </div>
  );
}

function AptSigningKeyScopeField({
  repository,
  value,
  onChange,
}: {
  repository: Repository;
  value: string;
  onChange: (value: string) => void;
}) {
  const signingKeys = useAptSigningKeys(repository.name);
  const activeKeys = activeSigningKeysForRepository(signingKeys.data ?? [], repository.name);

  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium">{repository.name} signing key scope</span>
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
