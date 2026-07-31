import type { RepositoryObjectsResponse } from "../../api/schemas";
import type { DestructiveActionDialogContent } from "../../components/ui/destructive-action-dialog-model";
import { sideDrawerBodyClass, sideDrawerContentClass } from "../../components/ui/side-drawer";

export interface RepositoryBrowserBreadcrumb {
  label: string;
  prefix: string;
}

export type RepositoryBrowserRow =
  | {
      kind: "directory";
      name: string;
      path: string;
      sizeLabel: "-";
      contentType: "Folder";
    }
  | {
      kind: "object";
      name: string;
      path: string;
      sizeLabel: string;
      contentType: string;
    };

export function repositoryBrowserBreadcrumbs(repositoryName: string, prefix: string): RepositoryBrowserBreadcrumb[] {
  const segments = prefix.split("/").filter(Boolean);
  const breadcrumbs: RepositoryBrowserBreadcrumb[] = [{ label: repositoryName, prefix: "" }];
  let current = "";
  for (const segment of segments) {
    current = `${current}${segment}/`;
    breadcrumbs.push({ label: segment, prefix: current });
  }
  return breadcrumbs;
}

export function repositoryBrowserObjectDeleteDialogContent(path: string): DestructiveActionDialogContent {
  return {
    title: "Delete object",
    description: `Delete ${path}? This removes the object from storage and records a repository activity entry.`,
    confirmLabel: "Delete object",
    pendingLabel: "Deleting...",
    confirmationText: "delete object",
  };
}

export function repositoryBrowserParentPrefix(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return path.slice(0, lastSlash + 1);
}

export function repositoryBrowserRows(listing: RepositoryObjectsResponse): RepositoryBrowserRow[] {
  return [
    ...listing.directories
      .map((directory): RepositoryBrowserRow => ({
        kind: "directory",
        name: directory.name,
        path: directory.path,
        sizeLabel: "-",
        contentType: "Folder",
      }))
      .sort(compareRows),
    ...listing.objects
      .map((object): RepositoryBrowserRow => ({
        kind: "object",
        name: object.name,
        path: object.path,
        sizeLabel: sizeLabel(object.size),
        contentType: object.contentType ?? "application/octet-stream",
      }))
      .sort(compareRows),
  ];
}

export function repositoryBrowserLayoutClasses(): {
  frame: string;
  empty: string;
  emptyPanel: string;
  loading: string;
  error: string;
} {
  return {
    frame: "min-h-64 overflow-hidden rounded-md border border-border bg-background/40",
    empty: "grid min-h-64 p-3",
    emptyPanel: "grid min-h-[calc(16rem-1.5rem)] place-items-center rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground",
    loading: "min-h-64 p-3 text-sm text-muted-foreground",
    error: "min-h-64 p-3",
  };
}

export function repositoryBrowserPublishDrawerContentClass(): string {
  return sideDrawerContentClass();
}

export function repositoryBrowserActivityDrawerContentClass(): string {
  return sideDrawerContentClass();
}

export function repositoryBrowserDrawerBodyClass(): string {
  return sideDrawerBodyClass();
}

function compareRows(left: Pick<RepositoryBrowserRow, "name">, right: Pick<RepositoryBrowserRow, "name">): number {
  return left.name.localeCompare(right.name);
}

function sizeLabel(size: number | undefined): string {
  if (size === undefined) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
