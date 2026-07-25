import { describe, expect, it } from "vitest";
import type { RepositoryObjectsResponse } from "../../api/schemas";
import {
  repositoryBrowserBreadcrumbs,
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
});
