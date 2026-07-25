import type { RepositoryObjectsResponse } from "../../api/schemas";

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
