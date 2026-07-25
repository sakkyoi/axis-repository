import type { DestructiveActionDialogContent } from "../../components/ui/destructive-action-dialog-model";
import type { RepositoryArtifact } from "../../api/schemas";

export function repositoryArtifactDeleteDialogContent(artifact: RepositoryArtifact): DestructiveActionDialogContent {
  return {
    title: "Delete artifact",
    description: `Delete ${artifact.summary}? This removes the artifact objects from storage and rebuilds the repository artifact index.`,
    confirmLabel: "Delete artifact",
    pendingLabel: "Deleting...",
    confirmationText: "delete artifact",
  };
}

export function repositoryArtifactObjectRelativePath(repositoryName: string, objectKey: string): string | undefined {
  const prefix = `repositories/${repositoryName}/`;
  if (!objectKey.startsWith(prefix)) {
    return undefined;
  }
  return objectKey.slice(prefix.length);
}
