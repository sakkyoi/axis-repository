// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Repository } from "../../api/schemas";
import { RepositoryDetailSections } from "./repository-detail-shared";

describe("RepositoryDetailSections", () => {
  it("leaves breathing room after the final detail section", () => {
    render(
      <RepositoryDetailSections
        repository={repository()}
        pluginMetadata={undefined}
        sections={[{
          id: "install-hints",
          title: "Install hints",
          placement: "workspace",
          Component: () => <div>pip install</div>,
        }]}
      />,
    );

    expect(screen.getByText("Install hints").closest("section")?.className).toContain("last:pb-4");
  });
});

function repository(): Repository {
  return {
    id: "repo_1",
    name: "python-internal",
    ecosystem: "pypi",
    kind: "hosted",
    visibility: "private",
    config: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
  };
}
