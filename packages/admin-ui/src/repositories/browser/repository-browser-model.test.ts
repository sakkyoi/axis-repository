import { describe, expect, it } from "vitest";
import type { RepositoryObjectsResponse } from "../../api/schemas";
import {
  repositoryBrowserActivityDrawerContentClass,
  repositoryBrowserBreadcrumbs,
  repositoryBrowserDrawerBodyClass,
  repositoryBrowserObjectDeleteDialogContent,
  repositoryBrowserLayoutClasses,
  repositoryBrowserPublishDrawerContentClass,
  repositoryBrowserRows,
} from "./repository-browser-model";

describe("repository browser model", () => {
  it("builds breadcrumbs from repository-relative prefixes", () => {
    expect(repositoryBrowserBreadcrumbs("debian-internal", "dists/noble/main/")).toEqual([
      { label: "debian-internal", prefix: "" },
      { label: "dists", prefix: "dists/" },
      { label: "noble", prefix: "dists/noble/" },
      { label: "main", prefix: "dists/noble/main/" },
    ]);
  });

  it("renders directories before files with stable display fields", () => {
    const listing: RepositoryObjectsResponse = {
      prefix: "dists/noble/",
      directories: [
        { name: "main", path: "dists/noble/main/" },
        { name: "contrib", path: "dists/noble/contrib/" },
      ],
      objects: [
        {
          name: "Release",
          path: "dists/noble/Release",
          size: 7,
          contentType: "text/plain",
          etag: "\"etag\"",
        },
      ],
      truncated: false,
    };

    expect(repositoryBrowserRows(listing)).toEqual([
      { kind: "directory", name: "contrib", path: "dists/noble/contrib/", sizeLabel: "-", contentType: "Folder" },
      { kind: "directory", name: "main", path: "dists/noble/main/", sizeLabel: "-", contentType: "Folder" },
      { kind: "object", name: "Release", path: "dists/noble/Release", sizeLabel: "7 B", contentType: "text/plain" },
    ]);
  });

  it("keeps empty repository states filling the browser frame", () => {
    expect(repositoryBrowserLayoutClasses()).toEqual({
      frame: "min-h-64 overflow-hidden rounded-md border border-border bg-background/40",
      empty: "grid min-h-64 p-3",
      emptyPanel: "grid min-h-[calc(16rem-1.5rem)] place-items-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground",
      loading: "min-h-64 p-3 text-sm text-muted-foreground",
      error: "min-h-64 p-3",
    });
  });

  it("keeps publish drawer content pinned below the header", () => {
    const className = repositoryBrowserPublishDrawerContentClass();

    expect(className).toContain("content-start");
    expect(className).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(className).toContain("overflow-hidden");
    expect(className).toContain("sm:h-dvh");
    expect(className).toContain("sm:right-0");
    expect(repositoryBrowserDrawerBodyClass()).toBe("min-h-0 overflow-y-auto pr-1");
  });

  it("renders activity as a right side panel instead of inline content", () => {
    const className = repositoryBrowserActivityDrawerContentClass();

    expect(className).toContain("content-start");
    expect(className).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(className).toContain("overflow-hidden");
    expect(className).toContain("sm:h-dvh");
    expect(className).toContain("sm:right-0");
    expect(className).toContain("sm:w-[min(92vw,440px)]");
  });

  it("builds destructive dialog copy for deleting an object", () => {
    expect(repositoryBrowserObjectDeleteDialogContent("pool/main/app_1.0.0_amd64.deb")).toEqual({
      title: "Delete object",
      description:
        "Delete pool/main/app_1.0.0_amd64.deb? This removes the object from storage and records a repository activity entry.",
      confirmLabel: "Delete object",
      pendingLabel: "Deleting...",
    });
  });
});
