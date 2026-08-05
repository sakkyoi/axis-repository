import { useEffect, useMemo, useRef } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAxisClient,
  type CreateAdminPublishSessionInput,
  type CreatePublishTokenInput,
  type ListBackgroundJobsOptions,
  type CreateRepositoryInput,
  type UpdateRepositoryPluginPolicyInput,
  type UpdateRepositoryInput,
} from "./client";
import { useAuth } from "../auth";
import { getRuntimeConfig } from "../runtime-config";

const REPOSITORY_ACTIVITY_PAGE_LIMIT = 10;
const REPOSITORY_ARTIFACT_PAGE_LIMIT = 50;

export function useAxisClient() {
  const { accessToken, refreshAccessToken } = useAuth();
  const { apiBaseUrl } = getRuntimeConfig();
  return useMemo(
    () => createAxisClient({ accessToken, baseUrl: apiBaseUrl, onUnauthorized: refreshAccessToken }),
    [accessToken, apiBaseUrl, refreshAccessToken],
  );
}

export function useRepositories() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repositories"],
    queryFn: () => client.listRepositories(),
  });
}

/**
 * What this deployment is still carrying that it no longer needs.
 *
 * Read once per session rather than polled: it only changes when someone edits
 * the deployment, which signs everyone out anyway.
 */
export function useDeployment() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["deployment"],
    queryFn: () => client.getDeployment(),
    staleTime: Infinity,
  });
}

export function useBackgroundJobs(options: ListBackgroundJobsOptions = {}) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["background-jobs", options],
    queryFn: () => client.listBackgroundJobs(options),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.status === "pending" || job.status === "running" || job.status === "canceling")
        ? 1500
        : false,
  });
}

export function useCancelBackgroundJob() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.cancelBackgroundJob(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-index-job"] });
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
    },
  });
}

export function useRetryBackgroundJob() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.retryBackgroundJob(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-index-job"] });
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
    },
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

export function useAdminSession() {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["admin-session"],
    queryFn: () => client.getAdminSession(),
  });
}

export function useChangeOwnPassword() {
  const client = useAxisClient();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) => client.changeOwnPassword(input),
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

export function useRepositoryArtifactsPages(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useInfiniteQuery({
    queryKey: ["repository-artifacts", repositoryName, "pages"],
    queryFn: ({ pageParam }) => client.listRepositoryArtifacts(repositoryName ?? "", {
      limit: REPOSITORY_ARTIFACT_PAGE_LIMIT,
      ...(pageParam ? { cursor: pageParam } : {}),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: Boolean(repositoryName),
  });
}

export function useRepositoryArtifactFamiliesPages(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useInfiniteQuery({
    queryKey: ["repository-artifact-families", repositoryName, "pages"],
    queryFn: ({ pageParam }) => client.listRepositoryArtifactFamilies(repositoryName ?? "", {
      limit: REPOSITORY_ARTIFACT_PAGE_LIMIT,
      ...(pageParam ? { cursor: pageParam } : {}),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: Boolean(repositoryName),
  });
}

export function useRepositoryArtifactFamilyArtifacts(
  repositoryName: string | undefined,
  family: string | undefined,
) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["repository-artifacts", repositoryName, "family", family],
    queryFn: () => client.listRepositoryArtifacts(repositoryName ?? "", { family: family ?? "" }),
    enabled: Boolean(repositoryName && family),
  });
}

export function useRepositoryArtifactIndexJob(repositoryName: string | undefined) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  const hadActiveJob = useRef(false);
  const query = useQuery({
    queryKey: ["repository-artifact-index-job", repositoryName],
    queryFn: async () => {
      if (!repositoryName) return { job: null };
      try {
        return { job: await client.getBackgroundJob(repositoryIndexBackgroundJobId(repositoryName)) };
      } catch (error) {
        if (errorResponseStatus(error) === 404) return { job: null };
        throw error;
      }
    },
    enabled: Boolean(repositoryName),
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return backgroundJobIsActive(status) ? 1500 : false;
    },
  });

  useEffect(() => {
    const status = query.data?.job?.status;
    const active = backgroundJobIsActive(status);
    if (active) {
      hadActiveJob.current = true;
      return;
    }
    if (!hadActiveJob.current || !repositoryName) {
      return;
    }
    hadActiveJob.current = false;
    void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
    void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "pages"] });
    void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "family"] });
    void queryClient.invalidateQueries({ queryKey: ["repository-artifact-families", repositoryName, "pages"] });
    void queryClient.invalidateQueries({ queryKey: ["repository-objects", repositoryName] });
    void queryClient.invalidateQueries({ queryKey: ["repository-activity", repositoryName] });
  }, [query.data?.job?.status, queryClient, repositoryName]);

  return query;
}

function repositoryIndexBackgroundJobId(repositoryName: string): string {
  return `repository.index:${repositoryName}`;
}

function backgroundJobIsActive(status: string | undefined): boolean {
  return status === "pending" || status === "running" || status === "canceling";
}

function errorResponseStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }
  return (error as { response?: { status?: number } }).response?.status;
}

export function useRebuildRepositoryArtifactIndex(repositoryName: string | undefined) {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.rebuildRepositoryArtifactIndex(repositoryName ?? ""),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-index-job", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "pages"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-families", repositoryName, "pages"] });
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
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-index-job", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "pages"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "family"] });
      void queryClient.invalidateQueries({ queryKey: ["repository-artifact-families", repositoryName, "pages"] });
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
      void queryClient.invalidateQueries({ queryKey: ["repository-artifacts", repositoryName, "pages"] });
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
    onSuccess: (result) => {
      const session = result.session;
      void queryClient.invalidateQueries({ queryKey: ["publish-sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["background-jobs"] });
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

