import type { PublishSession, PublishSessionStatus, Repository } from "../../api/schemas";

export type PublishSessionStatusVariant = "default" | "success" | "warning" | "destructive";

export interface RepositoryActivity {
  id: string;
  type: "publish";
  actionLabel: string;
  createdAt: string;
  status: {
    label: string;
    variant: PublishSessionStatusVariant;
  };
  session: PublishSession;
}

export function sessionsForRepository(repositoryName: string, sessions: PublishSession[]): PublishSession[] {
  return sessions.filter((session) => session.repositoryName === repositoryName);
}

export function repositoryPublishSessionsView(
  repository: Pick<Repository, "name" | "ecosystem">,
  sessions: PublishSession[],
): {
  sessions: PublishSession[];
  activities: RepositoryActivity[];
} {
  const repositorySessions = sessionsForRepository(repository.name, sessions);
  return {
    sessions: repositorySessions,
    activities: repositorySessions.map(repositoryActivityFromPublishSession),
  };
}

export function repositoryActivityFromPublishSession(session: PublishSession): RepositoryActivity {
  return {
    id: `publish:${session.id}`,
    type: "publish",
    actionLabel: session.artifacts.length === 1 ? "Published artifact" : "Published artifacts",
    createdAt: session.createdAt,
    status: publishSessionStatusMeta(session.status),
    session,
  };
}

export function publishSessionStatusMeta(status: PublishSessionStatus): {
  label: string;
  variant: PublishSessionStatusVariant;
} {
  switch (status) {
    case "finalized":
      return { label: "finalized", variant: "success" };
    case "failed":
    case "aborted":
    case "expired":
      return { label: status, variant: "destructive" };
    case "pending_uploads":
      return { label: "pending uploads", variant: "warning" };
    case "ready":
    case "finalizing":
      return { label: status, variant: "default" };
  }
}

export function publishSessionArtifactSummary(session: PublishSession): string {
  const artifactLabel = session.artifacts.length === 1 ? "artifact" : "artifacts";
  return `${session.artifacts.length} ${artifactLabel}, ${session.verifiedUploads.length} verified`;
}
