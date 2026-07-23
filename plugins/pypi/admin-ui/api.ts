import { useQuery } from "@tanstack/react-query";
import { useAxisClient } from "../../../packages/admin-ui/src/api/hooks";
import { pypiClientInfoSchema, type PypiClientInfo } from "./schemas";

const pypiNamespace = "pypi";

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
