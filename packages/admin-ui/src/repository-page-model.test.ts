import { describe, expect, it } from "vitest";
import {
  aptInstallCommandText,
  initialRepositorySelection,
  repositoryDetailBodyClass,
  repositoryRowStateClass,
} from "./repository-page-model";
import type { InstallInstructions, Repository } from "./api/schemas";

describe("repository page model", () => {
  it("does not preselect a repository", () => {
    expect(initialRepositorySelection([repository("debian-internal")])).toBeUndefined();
  });

  it("highlights only the selected repository row", () => {
    expect(repositoryRowStateClass("debian-internal", "debian-internal")).toContain("border-l-primary");
    expect(repositoryRowStateClass("debian-internal", "debian-internal")).not.toContain("text-primary-foreground");
    expect(repositoryRowStateClass("debian-internal", undefined)).not.toContain("border-l-primary");
  });

  it("keeps short repository details packed at the top of the scroll area", () => {
    expect(repositoryDetailBodyClass()).toContain("content-start");
  });

  it("renders APT install instructions as shell commands with optional auth config", () => {
    const instructions: InstallInstructions = {
      repository: "debian-private",
      visibility: "private",
      keyUrl: "https://axis.example/repositories/debian-private/apt/key.gpg",
      keyringPath: "/usr/share/keyrings/axis-debian-private.gpg",
      sourceListPath: "/etc/apt/sources.list.d/axis-debian-private.list",
      sourceLine:
        "deb [signed-by=/usr/share/keyrings/axis-debian-private.gpg] https://axis.example/repositories/debian-private noble main",
      script: "# Install from the APT plugin.\nsudo apt update",
      authConfPath: "/etc/apt/auth.conf.d/axis-debian-private.conf",
      authConfTemplate: "machine axis.example\nlogin axis\npassword <READ_TOKEN>\n",
      commands: ["curl -fsSL https://axis.example/key.gpg", "sudo apt update"],
    };

    expect(aptInstallCommandText(instructions)).toBe("# Install from the APT plugin.\nsudo apt update");
  });
});

function repository(name: string): Repository {
  return {
    id: `repo_${name}`,
    name,
    ecosystem: "apt",
    visibility: "private",
    config: {},
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
}
