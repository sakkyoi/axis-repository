import type {
  PublishSession,
  PublishSessionStatus,
  Repository,
  RepositoryActivity as ApiRepositoryActivity,
} from "../../api/schemas";

export type PublishSessionStatusVariant = "default" | "success" | "warning" | "destructive";

export const REPOSITORY_ACTIVITY_PAGE_SIZE = 10;

export type RepositoryActivity = ApiRepositoryActivity;

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
  const artifactLabel = session.artifacts.length === 1 ? "artifact" : "artifacts";
  return {
    id: `publish:${session.id}`,
    repositoryName: session.repositoryName,
    type: "publish",
    actor: "publish-token",
    summary: `Published ${session.artifacts.length} ${artifactLabel}`,
    metadata: {},
    createdAt: session.createdAt,
    session,
  };
}

export function repositoryActivityPage(
  activities: RepositoryActivity[],
  visibleCount = REPOSITORY_ACTIVITY_PAGE_SIZE,
): {
  visibleActivities: RepositoryActivity[];
  visibleCount: number;
  hasMoreActivities: boolean;
  nextVisibleCount: number;
  totalCount: number;
} {
  const normalizedVisibleCount = Math.min(Math.max(visibleCount, REPOSITORY_ACTIVITY_PAGE_SIZE), activities.length);
  return {
    visibleActivities: activities.slice(0, normalizedVisibleCount),
    visibleCount: normalizedVisibleCount,
    hasMoreActivities: normalizedVisibleCount < activities.length,
    nextVisibleCount: Math.min(normalizedVisibleCount + REPOSITORY_ACTIVITY_PAGE_SIZE, activities.length),
    totalCount: activities.length,
  };
}

export function repositoryActivityActionLabel(activity: RepositoryActivity): string {
  if (activity.type === "publish") {
    return activity.session.artifacts.length === 1 ? "Published artifact" : "Published artifacts";
  }
  return "Deleted object";
}

export function repositoryActivityStatusMeta(activity: RepositoryActivity): {
  label: string;
  variant: PublishSessionStatusVariant;
} {
  if (activity.type === "publish") {
    return publishSessionStatusMeta(activity.session.status);
  }
  return { label: "deleted", variant: "destructive" };
}

export function repositoryActivitySummary(
  activity: RepositoryActivity,
  publishArtifactSummary: (session: PublishSession) => string,
): string {
  if (activity.type === "publish") {
    return publishArtifactSummary(activity.session);
  }
  const path = activity.metadata.path;
  return typeof path === "string" ? path : activity.summary;
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
