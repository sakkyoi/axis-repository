import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAxisClient,
  type CreateAdminPublishSessionInput,
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

export function useRepositoryPlugins() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-plugins"],
    queryFn: () => client.listRepositoryPlugins(),
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

export function useAptSigningPublicKey(repositoryName: string | undefined, enabled: boolean) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["apt-public-key", repositoryName],
    queryFn: () => client.getAptSigningPublicKey(repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function useAptSourceInfo(repositoryName: string | undefined, enabled: boolean) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["apt-source", repositoryName],
    queryFn: () => client.getAptSourceInfo(repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function usePypiClientInfo(repositoryName: string | undefined, enabled: boolean) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["pypi-client-info", repositoryName],
    queryFn: () => client.getPypiClientInfo(repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function useRepositoryClientHelper(
  repositoryName: string | undefined,
  namespace: string | undefined,
  action: string | undefined,
  enabled: boolean,
) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-client-helper", repositoryName, namespace, action],
    queryFn: () => client.getRepositoryClientHelper(repositoryName ?? "", namespace ?? "", action ?? ""),
    enabled: Boolean(repositoryName && namespace && action) && enabled,
  });
}

export function usePublishSessions() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["publish-sessions"],
    queryFn: () => client.listPublishSessions(),
  });
}

export function useCreateAdminPublishSession() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAdminPublishSessionInput) => client.createAdminPublishSession(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-sessions"] }),
  });
}

export function useVerifyAdminPublishUpload() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, uploadId }: { sessionId: string; uploadId: string }) =>
      client.verifyAdminPublishUpload(sessionId, uploadId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-sessions"] }),
  });
}

export function useFinalizeAdminPublishSession() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => client.finalizeAdminPublishSession(sessionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-sessions"] }),
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

export function useAptSigningKeys(repositoryName: string | undefined, enabled = true) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["apt-signing-keys", repositoryName],
    queryFn: () => client.listAptSigningKeys(repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export function useImportAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repositoryName, input }: { repositoryName: string; input: ImportAptSigningKeyInput }) =>
      client.importAptSigningKey(repositoryName, input),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["apt-signing-keys", variables.repositoryName] }),
  });
}

export function useGenerateAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repositoryName, input }: { repositoryName: string; input: GenerateAptSigningKeyInput }) =>
      client.generateAptSigningKey(repositoryName, input),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["apt-signing-keys", variables.repositoryName] }),
  });
}

export function useRevokeAptSigningKey() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repositoryName, id }: { repositoryName: string; id: string }) =>
      client.revokeAptSigningKey(repositoryName, id),
    onSuccess: (_data, variables) => queryClient.invalidateQueries({ queryKey: ["apt-signing-keys", variables.repositoryName] }),
  });
}
