import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAxisClient,
  type CreateAdminPublishSessionInput,
  type CreatePublishTokenInput,
  type CreateRepositoryInput,
  type UpdateRepositoryPluginPolicyInput,
  type UpdateRepositoryInput,
} from "./client";
import { useAuth } from "../auth";
import { getRuntimeConfig } from "../runtime-config";

const REPOSITORY_ACTIVITY_PAGE_LIMIT = 10;

export function useAxisClient() {
  const { accessToken } = useAuth();
  const { apiBaseUrl } = getRuntimeConfig();
  return useMemo(() => createAxisClient({ accessToken, baseUrl: apiBaseUrl }), [accessToken, apiBaseUrl]);
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

export function useAdminUsers() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => client.listAdminUsers(),
  });
}

export function useUpdateRepositoryPluginPolicy() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ecosystem, input }: { ecosystem: string; input: UpdateRepositoryPluginPolicyInput }) =>
      client.updateRepositoryPluginPolicy(ecosystem, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repository-plugins"] }),
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

export function useDeleteRepository() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.deleteRepository(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repositories"] });
      void queryClient.invalidateQueries({ queryKey: ["publish-tokens"] });
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
    },
  });
}

export function useRepositoryObjects(repositoryName: string | undefined, prefix: string) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-objects", repositoryName, prefix],
    queryFn: () => client.listRepositoryObjects(repositoryName ?? "", prefix),
    enabled: Boolean(repositoryName),
  });
}

export function useRepositoryArtifacts(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-artifacts", repositoryName],
    queryFn: () => client.listRepositoryArtifacts(repositoryName ?? ""),
    enabled: Boolean(repositoryName),
  });
}

export function useRebuildRepositoryArtifactIndex(repositoryName: string | undefined) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.rebuildRepositoryArtifactIndex(repositoryName ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", repositoryName] });
    },
  });
}

export function useDeleteRepositoryArtifact(repositoryName: string | undefined) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (artifactId: string) => client.deleteRepositoryArtifact(repositoryName ?? "", artifactId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-object-detail", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", repositoryName] });
    },
  });
}

export function useRepositoryObjectDetail(repositoryName: string | undefined, path: string | undefined) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-object-detail", repositoryName, path],
    queryFn: () => client.getRepositoryObjectDetail(repositoryName ?? "", path ?? ""),
    enabled: Boolean(repositoryName && path),
  });
}

export function useDeleteRepositoryObject(repositoryName: string | undefined) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => client.deleteRepositoryObject(repositoryName ?? "", path),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-object-detail", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", repositoryName] });
    },
  });
}

export function useRepositoryActivities(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useInfiniteQuery({
    queryKey: ["repository-activity", repositoryName],
    queryFn: ({ pageParam }) =>
      client.listRepositoryActivities(repositoryName ?? "", {
        limit: REPOSITORY_ACTIVITY_PAGE_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: Boolean(repositoryName),
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
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", session.repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", session.repositoryName] });
    },
  });
}

export function useVerifyAdminPublishUpload() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, uploadId }: { sessionId: string; uploadId: string }) =>
      client.verifyAdminPublishUpload(sessionId, uploadId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", session.repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", session.repositoryName] });
    },
  });
}

export function useFinalizeAdminPublishSession() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => client.finalizeAdminPublishSession(sessionId),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", session.repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-object-detail", session.repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", session.repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", session.repositoryName] });
    },
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

export function useRotatePublishToken() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.rotatePublishToken(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-tokens"] }),
  });
}

export function useDeletePublishToken() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => client.deletePublishToken(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["publish-tokens"] }),
  });
}

