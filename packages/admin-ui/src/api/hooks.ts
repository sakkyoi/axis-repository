import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useRepositoryObjects(repositoryName: string | undefined, prefix: string) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-objects", repositoryName, prefix],
    queryFn: () => client.listRepositoryObjects(repositoryName ?? "", prefix),
    enabled: Boolean(repositoryName),
  });
}

export function useDeleteRepositoryObject(repositoryName: string | undefined, prefix: string) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => client.deleteRepositoryObject(repositoryName ?? "", path),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName, prefix] });
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", repositoryName] });
    },
  });
}

export function useRepositoryActivities(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-activity", repositoryName],
    queryFn: () => client.listRepositoryActivities(repositoryName ?? ""),
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
      void queryClient.invalidateQueries({ queryKey: ["repository-activity", session.repositoryName] });
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

