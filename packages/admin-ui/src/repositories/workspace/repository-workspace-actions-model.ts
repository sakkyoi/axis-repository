export interface RepositoryWorkspaceActionItem {
  id: "activity" | "publish";
  label: string;
}

export function repositoryWorkspaceActions(input: { canPublish: boolean }): RepositoryWorkspaceActionItem[] {
  return [
    { id: "activity", label: "Activity" },
    ...(input.canPublish ? [{ id: "publish" as const, label: "Publish artifact" }] : []),
  ];
}
