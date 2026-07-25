import { describe, expect, it } from "vitest";

import type { PublishSession } from "../../api/schemas";
import {
  REPOSITORY_ACTIVITY_PAGE_SIZE,
  publishSessionArtifactSummary,
  publishSessionStatusMeta,
  repositoryActivityActionLabel,
  repositoryActivityPage,
  repositoryActivityStatusMeta,
  repositoryActivitySummary,
  repositoryPublishSessionsView,
  sessionsForRepository,
} from "./repository-publish-sessions-model";

const session = (overrides: Partial<PublishSession>): PublishSession => ({
  id: "pub_1",
  repositoryName: "debian-internal",
  ecosystem: "apt",
  status: "pending_uploads",
  requestedBy: {
    tokenId: "tok_1",
    name: "ci",
    permissions: ["publish"],
    repositories: ["debian-internal"],
    ecosystemScopes: {},
    signingKeyIds: [],
  },
  artifacts: [],
  uploads: [],
  verifiedUploads: [],
  createdAt: "2026-07-23T00:00:00.000Z",
  expiresAt: "2026-07-23T00:10:00.000Z",
  ...overrides,
});

describe("repository publish sessions model", () => {
  it("keeps publish sessions view independent from ecosystem-specific renderers", () => {
    expect(repositoryPublishSessionsView({ name: "debian-internal", ecosystem: "apt" }, [])).toEqual({
      sessions: [],
      activities: [],
    });
  });

  it("filters sessions for a repository and preserves API ordering", () => {
    expect(
      sessionsForRepository("debian-internal", [
        session({ id: "pub_new", repositoryName: "debian-internal" }),
        session({ id: "pub_python", repositoryName: "python-internal", ecosystem: "pypi" }),
        session({ id: "pub_old", repositoryName: "debian-internal" }),
      ]),
    ).toMatchObject([{ id: "pub_new" }, { id: "pub_old" }]);
  });

  it("returns status metadata for terminal and active sessions", () => {
    expect(publishSessionStatusMeta("finalized")).toMatchObject({
      label: "finalized",
      variant: "success",
    });
    expect(publishSessionStatusMeta("failed")).toMatchObject({
      label: "failed",
      variant: "destructive",
    });
    expect(publishSessionStatusMeta("pending_uploads")).toMatchObject({
      label: "pending uploads",
      variant: "warning",
    });
  });

  it("summarizes artifacts and verification progress", () => {
    expect(
      publishSessionArtifactSummary(
        session({
          artifacts: [
            {
              filename: "myapp_1.2.3_amd64.deb",
              size: 1234,
              sha256: "a".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {},
            },
            {
              filename: "myapp-dbgsym_1.2.3_amd64.deb",
              size: 5678,
              sha256: "b".repeat(64),
              contentType: "application/vnd.debian.binary-package",
              metadata: {},
            },
          ],
          verifiedUploads: [
            {
              uploadId: "upl_1",
              objectKey: "_staging/uploads/pub_1/upl_1/myapp.deb",
              size: 1234,
              sha256: "a".repeat(64),
              verifiedAt: "2026-07-23T00:02:00.000Z",
            },
          ],
        }),
      ),
    ).toBe("2 artifacts, 1 verified");
  });

  it("maps repository publish sessions into compact activity rows", () => {
    const publishSession = session({
      id: "pub_new",
      repositoryName: "debian-internal",
      status: "finalized",
      artifacts: [{
        filename: "myapp_1.2.3_amd64.deb",
        size: 1234,
        sha256: "a".repeat(64),
        contentType: "application/vnd.debian.binary-package",
        metadata: {},
      }],
      verifiedUploads: [{
        uploadId: "upl_1",
        objectKey: "_staging/uploads/pub_new/upl_1/myapp.deb",
        size: 1234,
        sha256: "a".repeat(64),
        verifiedAt: "2026-07-23T00:02:00.000Z",
      }],
    });

    expect(
      repositoryPublishSessionsView({ name: "debian-internal", ecosystem: "apt" }, [
        publishSession,
        session({ id: "pub_other", repositoryName: "python-internal", ecosystem: "pypi" }),
      ]).activities,
    ).toEqual([{
      id: "publish:pub_new",
      repositoryName: "debian-internal",
      type: "publish",
      actor: "publish-token",
      summary: "Published 1 artifact",
      metadata: {},
      createdAt: "2026-07-23T00:00:00.000Z",
      session: publishSession,
    }]);

    const activity = repositoryPublishSessionsView({ name: "debian-internal", ecosystem: "apt" }, [publishSession]).activities[0]!;
    expect(repositoryActivityActionLabel(activity)).toBe("Published artifact");
    expect(repositoryActivityStatusMeta(activity)).toEqual({ label: "finalized", variant: "success" });
    expect(repositoryActivitySummary(activity, publishSessionArtifactSummary)).toBe("1 artifact, 1 verified");
  });

  it("pages repository activities with an explicit load more state", () => {
    const activities = Array.from({ length: 23 }, (_, index) => ({
      id: `publish:pub_${index}`,
      repositoryName: "debian-internal",
      type: "publish" as const,
      actor: "publish-token" as const,
      summary: "Published 1 artifact",
      metadata: {},
      createdAt: `2026-07-23T00:${String(index).padStart(2, "0")}:00.000Z`,
      session: session({ id: `pub_${index}` }),
    }));

    expect(repositoryActivityPage(activities)).toMatchObject({
      visibleActivities: activities.slice(0, REPOSITORY_ACTIVITY_PAGE_SIZE),
      visibleCount: REPOSITORY_ACTIVITY_PAGE_SIZE,
      hasMoreActivities: true,
      nextVisibleCount: 20,
      totalCount: 23,
    });

    expect(repositoryActivityPage(activities, 20)).toMatchObject({
      visibleActivities: activities.slice(0, 20),
      visibleCount: 20,
      hasMoreActivities: true,
      nextVisibleCount: 23,
      totalCount: 23,
    });

    expect(repositoryActivityPage(activities, 23)).toMatchObject({
      visibleActivities: activities,
      visibleCount: 23,
      hasMoreActivities: false,
      nextVisibleCount: 23,
      totalCount: 23,
    });
  });

  it("labels object update activities", () => {
    const activity = {
      id: "activity_1",
      repositoryName: "debian-internal",
      type: "object.update" as const,
      actor: "admin" as const,
      summary: "Updated dists/noble/Release",
      metadata: {
        path: "dists/noble/Release",
        previousContentType: "text/plain",
        contentType: "text/plain; charset=utf-8",
      },
      createdAt: "2026-07-23T00:00:00.000Z",
    };

    expect(repositoryActivityActionLabel(activity)).toBe("Updated object");
    expect(repositoryActivityStatusMeta(activity)).toEqual({ label: "updated", variant: "warning" });
    expect(repositoryActivitySummary(activity, publishSessionArtifactSummary)).toBe("dists/noble/Release");
  });
});
