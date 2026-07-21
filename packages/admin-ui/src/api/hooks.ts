import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAxisClient, type CreatePublishTokenInput, type CreateSigningKeyInput, type UpdateRepositoryInput } from "./client";
import { getAdminToken, getApiBaseUrl } from "../settings";

export function useAxisClient() {
  const adminToken = getAdminToken();
  const baseUrl = getApiBaseUrl();
  return useMemo(() => createAxisClient({ adminToken, baseUrl }), [adminToken, baseUrl]);
}

export function useRepositories() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repositories"],
    queryFn: () => client.listRepositories(),
  });
}

export function useUpdateRepository() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, input }: { name: string; input: UpdateRepositoryInput }) =>
      client.updateRepository(name, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repositories"] }),
  });
}

export function useAptInstallInstructions(repositoryName: string | undefined, enabled: boolean) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["apt-install", repositoryName],
    queryFn: () => client.getAptInstallInstructions(repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function usePublishTokens() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["publish-tokens"],
    queryFn: () => client.listPublishTokens(),
  });
}

export function useCreatePublishToken() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePublishTokenInput) => client.createPublishToken(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-tokens"] }),
  });
}

export function useRevokePublishToken() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.revokePublishToken(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-tokens"] }),
  });
}

export function useSigningKeys() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["signing-keys"],
    queryFn: () => client.listSigningKeys(),
  });
}

export function useCreateSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSigningKeyInput) => client.createSigningKey(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["signing-keys"] }),
  });
}

export function useRevokeSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.revokeSigningKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["signing-keys"] }),
  });
}
