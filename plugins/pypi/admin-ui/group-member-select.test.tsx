// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { PypiGroupMemberSelectView } from "./group-member-select";
import type { Repository } from "@axis-repository/admin-ui/plugin-ui";

function repository(input: Pick<Repository, "name" | "kind" | "ecosystem">): Repository {
  return {
    id: `repo_${input.name}`,
    name: input.name,
    ecosystem: input.ecosystem,
    kind: input.kind,
    visibility: "private",
    config: {},
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
}

describe("PypiGroupMemberSelect", () => {
  afterEach(() => cleanup());

  it("searches selectable repositories and writes selected members in order", async () => {
    const user = userEvent.setup();
    const changes: string[][] = [];
    render(
      <PypiGroupMemberSelectFixture
        repositoryName="python-group"
        repositories={[
          repository({ name: "python-proxy", ecosystem: "pypi", kind: "proxy" }),
        ]}
        value={["python-hosted"]}
        onChange={(members) => changes.push(members)}
      />,
    );

    expect(screen.getByText("python-hosted")).not.toBeNull();
    await user.type(screen.getByPlaceholderText("Select repositories"), "proxy");
    expect(screen.getByRole("option", { name: "Select python-proxy" })).not.toBeNull();

    await user.click(screen.getByRole("option", { name: "Select python-proxy" }));

    expect(changes.at(-1)).toEqual(["python-hosted", "python-proxy"]);
  });

  it("closes the repository list when focus leaves the selector", async () => {
    const user = userEvent.setup();
    render(
      <>
        <PypiGroupMemberSelectFixture
          repositoryName="python-group"
          repositories={[repository({ name: "python-hosted", ecosystem: "pypi", kind: "hosted" })]}
          value={[]}
          onChange={() => {}}
        />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByPlaceholderText("Select repositories"));
    expect(screen.getByRole("option", { name: "Select python-hosted" })).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    await waitFor(() => expect(screen.queryByRole("option", { name: "Select python-hosted" })).toBeNull());
  });

  it("selects a repository when clicking anywhere on the item row", async () => {
    const user = userEvent.setup();
    const changes: string[][] = [];
    render(
      <PypiGroupMemberSelectFixture
        repositoryName="python-group"
        repositories={[repository({ name: "python-proxy", ecosystem: "pypi", kind: "proxy" })]}
        value={[]}
        onChange={(members) => changes.push(members)}
      />,
    );

    await user.click(screen.getByPlaceholderText("Select repositories"));
    await user.click(screen.getByText("python-proxy"));

    expect(changes.at(-1)).toEqual(["python-proxy"]);
    expect(screen.getByRole("option", { name: "Select python-proxy" })).not.toBeNull();
  });
});

function PypiGroupMemberSelectFixture(
  props: Omit<Parameters<typeof PypiGroupMemberSelectView>[0], "open" | "onOpenChange" | "query" | "onQueryChange">,
) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  return (
    <PypiGroupMemberSelectView
      {...props}
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
    />
  );
}
