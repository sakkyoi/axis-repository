import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAxisClient } from "@axis-repository/admin-ui/plugin-ui";
import {
  pypiClientInfoSchema,
  pypiProjectSchema,
  pypiProjectsSchema,
  type PypiClientInfo,
  type PypiProject,
  type PypiProjects,
} from "./schemas";

const pypiNamespace = "pypi";
const pypiProjectsQueryKey = "pypi-projects";

export interface PypiClientInfoClient {
  getRepositoryClientHelper(repositoryName: string, namespace: string, action: string): Promise<unknown>;
}

export async function getPypiClientInfo(client: PypiClientInfoClient, repositoryName: string): Promise<PypiClientInfo> {
  const response = await client.getRepositoryClientHelper(repositoryName, pypiNamespace, "simple-url");
  return pypiClientInfoSchema.parse(response);
}

export function usePypiClientInfo(repositoryName: string | undefined, enabled: boolean) {
  const client = useAxisClient();
  return useQuery({
    queryKey: ["pypi-client-info", repositoryName],
    queryFn: () => getPypiClientInfo(client, repositoryName ?? ""),
    enabled: Boolean(repositoryName) && enabled,
  });
}

export interface PypiProjectsClient {
  getRepositoryPluginResource(
    repositoryName: string,
    namespace: string,
    path: readonly string[],
    options?: { searchParams?: Record<string, string | number | undefined> },
  ): Promise<unknown>;
  postRepositoryPluginResource(
    repositoryName: string,
    namespace: string,
    path: readonly string[],
    input?: unknown,
  ): Promise<unknown>;
}

export async function listPypiProjects(
  client: PypiProjectsClient,
  repositoryName: string,
  options: { limit?: number; cursor?: string } = {},
): Promise<PypiProjects> {
  const response = await client.getRepositoryPluginResource(repositoryName, pypiNamespace, ["projects"], {
    searchParams: options,
  });
  return pypiProjectsSchema.parse(response);
}

export async function getPypiProject(
  client: PypiProjectsClient,
  repositoryName: string,
  project: string,
): Promise<PypiProject> {
  const response = await client.getRepositoryPluginResource(repositoryName, pypiNamespace, ["projects", project]);
  return pypiProjectSchema.parse(response).project;
}

export function usePypiProjectsPage(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useQuery({
    queryKey: [pypiProjectsQueryKey, repositoryName],
    queryFn: () => listPypiProjects(client, repositoryName ?? ""),
    enabled: Boolean(repositoryName),
  });
}

export function usePypiProjects(repositoryName: string | undefined) {
  const client = useAxisClient();
  return useInfiniteQuery({
    queryKey: [pypiProjectsQueryKey, repositoryName],
    queryFn: ({ pageParam }) => listPypiProjects(client, repositoryName ?? "", {
      limit: 50,
      ...(pageParam ? { cursor: pageParam } : {}),
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: Boolean(repositoryName),
  });
}

export function usePypiProject(repositoryName: string | undefined, project: string | undefined) {
  const client = useAxisClient();
  return useQuery({
    queryKey: [pypiProjectsQueryKey, repositoryName, "project", project],
    queryFn: () => getPypiProject(client, repositoryName ?? "", project ?? ""),
    enabled: Boolean(repositoryName && project),
  });
}

export interface SetPypiFileYankedInput {
  repositoryName: string;
  project: string;
  filename: string;
  /** A reason when yanking; undefined lifts the yank. */
  reason: string | undefined;
  yanked: boolean;
}

export async function setPypiFileYanked(
  client: PypiProjectsClient,
  input: SetPypiFileYankedInput,
): Promise<void> {
  await client.postRepositoryPluginResource(
    input.repositoryName,
    pypiNamespace,
    ["projects", input.project, "files", input.filename, input.yanked ? "yank" : "unyank"],
    input.yanked ? { reason: input.reason ?? "" } : undefined,
  );
}

export function useSetPypiFileYanked() {
  const client = useAxisClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SetPypiFileYankedInput) => setPypiFileYanked(client, input),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: [pypiProjectsQueryKey, variables.repositoryName] }),
  });
}
