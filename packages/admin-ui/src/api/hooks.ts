import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAxisClient,
  type GenerateAptSigningKeyInput,
  type ImportAptSigningKeyInput,
  type CreatePublishTokenInput,
  type CreateRepositoryInput,
  type UpdateRepositoryInput,
} from "./client";
import { useAuth } from "../auth";
import { getRuntimeConfig } from "../runtime-config";

export function useAxisClient() {
  const { adminToken } = useAuth();
  const { apiBaseUrl } = getRuntimeConfig();
  return useMemo(() => createAxisClient({ adminToken, baseUrl: apiBaseUrl }), [adminToken, apiBaseUrl]);
}

export function useRepositories() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repositories"],
    queryFn: () => client.listRepositories(),
  });
}

export function useCreateRepository() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRepositoryInput) => client.createRepository(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repositories"] }),
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

export function useAptSigningKeys() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["apt-signing-keys"],
    queryFn: () => client.listAptSigningKeys(),
  });
}

export function useImportAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportAptSigningKeyInput) => client.importAptSigningKey(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apt-signing-keys"] }),
  });
}

export function useGenerateAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GenerateAptSigningKeyInput) => client.generateAptSigningKey(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apt-signing-keys"] }),
  });
}

export function useRevokeAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.revokeAptSigningKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["apt-signing-keys"] }),
  });
}
