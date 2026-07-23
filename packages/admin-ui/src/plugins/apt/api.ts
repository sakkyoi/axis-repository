import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAxisClient } from "../../api/hooks";
import { signingKeySchema, signingKeysResponseSchema, type SigningKey } from "../../api/schemas";

const aptNamespace = "apt";
const aptSigningKeysQueryKey = "apt-signing-keys";

export interface ImportAptSigningKeyInput {
  name: string;
  privateKeyArmored: string;
  passphrase: string;
}

export interface GenerateAptSigningKeyInput {
  name: string;
  userIdName: string;
  userIdEmail: string;
}

export interface AptSigningKeyClient {
  getRepositoryPluginResource(repositoryName: string, namespace: string, path: readonly string[]): Promise<unknown>;
  postRepositoryPluginResource(
    repositoryName: string,
    namespace: string,
    path: readonly string[],
    input?: unknown,
  ): Promise<unknown>;
}

export async function listAptSigningKeys(client: AptSigningKeyClient, repositoryName: string): Promise<SigningKey[]> {
  const response = await client.getRepositoryPluginResource(repositoryName, aptNamespace, ["signing-keys"]);
  return signingKeysResponseSchema.parse(response).signingKeys;
}

export async function importAptSigningKey(
  client: AptSigningKeyClient,
  repositoryName: string,
  input: ImportAptSigningKeyInput,
): Promise<SigningKey> {
  const response = await client.postRepositoryPluginResource(repositoryName, aptNamespace, ["signing-keys", "import"], input);
  return signingKeySchema.parse(response);
}

export async function generateAptSigningKey(
  client: AptSigningKeyClient,
  repositoryName: string,
  input: GenerateAptSigningKeyInput,
): Promise<SigningKey> {
  const response = await client.postRepositoryPluginResource(repositoryName, aptNamespace, ["signing-keys", "generate"], input);
  return signingKeySchema.parse(response);
}

export async function revokeAptSigningKey(
  client: AptSigningKeyClient,
  repositoryName: string,
  id: string,
): Promise<SigningKey> {
  const response = await client.postRepositoryPluginResource(repositoryName, aptNamespace, ["signing-keys", id, "revoke"]);
  return signingKeySchema.parse(response);
}

export function useAptSigningKeys(repositoryName: string | undefined, enabled = true) {
  const client = useAxisClient();
  return useQuery({
    queryKey: [aptSigningKeysQueryKey, repositoryName],
    queryFn: () => listAptSigningKeys(client, repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function useImportAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repositoryName, input }: { repositoryName: string; input: ImportAptSigningKeyInput }) =>
      importAptSigningKey(client, repositoryName, input),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: [aptSigningKeysQueryKey, variables.repositoryName] }),
  });
}

export function useGenerateAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repositoryName, input }: { repositoryName: string; input: GenerateAptSigningKeyInput }) =>
      generateAptSigningKey(client, repositoryName, input),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: [aptSigningKeysQueryKey, variables.repositoryName] }),
  });
}

export function useRevokeAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repositoryName, id }: { repositoryName: string; id: string }) =>
      revokeAptSigningKey(client, repositoryName, id),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: [aptSigningKeysQueryKey, variables.repositoryName] }),
  });
}
