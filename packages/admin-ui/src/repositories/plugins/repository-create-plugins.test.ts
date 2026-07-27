import { describe, expect, it } from "vitest";
import {
  repositoryCreateAvailabilityError,
  repositoryCreateFieldErrors,
  repositoryCreatePlugins,
  repositoryCreateStepForServerError,
} from "./repository-create-plugins";
import {
  getRepositoryCreatePlugin,
} from "./repository-ui-plugins";

describe("repository create plugins", () => {
  it("exposes APT as a wizard plugin with config and setup steps", () => {
    expect(repositoryCreatePlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt", "pypi"]);
    expect(getRepositoryCreatePlugin("apt")!).toMatchObject({
      ecosystem: "apt",
      steps: ["plugin", "basics", "config", "setup", "review"],
    });
    expect(getRepositoryCreatePlugin("pypi")!).toMatchObject({
      ecosystem: "pypi",
      steps: ["plugin", "basics", "review"],
    });
  });

  it("derives create steps from repository config field steps", () => {
    expect(getRepositoryCreatePlugin("apt")!.steps).toEqual(["plugin", "basics", "config", "setup", "review"]);
    expect(getRepositoryCreatePlugin("pypi")!.steps).toEqual(["plugin", "basics", "review"]);
  });

  it("exposes repository config fields to the wizard renderer", () => {
    const plugin = getRepositoryCreatePlugin("apt")!;

    expect(plugin.repositoryConfig.namespace).toBe("apt");
    expect(plugin.repositoryConfig.fields.map((field) => [field.name, field.kind, field.step])).toEqual([
      ["codename", "text", "config"],
      ["suites", "string-list", "config"],
      ["signingKey", "signing-key-provisioning", "setup"],
    ]);
  });

  it("builds an APT repository create payload from wizard state", () => {
    const plugin = getRepositoryCreatePlugin("apt")!;

    expect(plugin.buildCreateInput({
      name: "debian-internal",
      visibility: "private",
      config: {
        codename: "noble",
      },
      setup: {
        signingKeyMode: "generate",
        signingKeyName: "release",
        signingKeyUserIdName: "Axis Repository",
        signingKeyUserIdEmail: "axis@example.test",
      },
    })).toEqual({
      name: "debian-internal",
      ecosystem: "apt",
      visibility: "private",
      config: {
        apt: {
          codename: "noble",
        },
      },
      provisioning: {
        apt: {
          signingKey: {
            mode: "generate",
            name: "release",
            userIdName: "Axis Repository",
            userIdEmail: "axis@example.test",
          },
        },
      },
    });
  });

  it("builds a PyPI repository create payload from wizard state", () => {
    const plugin = getRepositoryCreatePlugin("pypi")!;

    expect(plugin.buildCreateInput({
      name: "python-internal",
      visibility: "private",
      config: {},
      setup: {},
    })).toEqual({
      name: "python-internal",
      ecosystem: "pypi",
      visibility: "private",
      config: {
        pypi: {},
      },
    });
  });

  it("maps every server-side repository name rejection back to the basics step", () => {
    const plugin = getRepositoryCreatePlugin("apt")!;

    for (const message of [
      "Repository already exists: debian-internal",
      "Repository name is required",
      "Repository name must be at most 100 characters",
      "Repository name must start with a letter or digit and use only letters, digits, dot, underscore, or hyphen",
    ]) {
      expect(repositoryCreateStepForServerError(message, plugin), message).toBe("basics");
      expect(repositoryCreateFieldErrors(message), message).toEqual({ name: message });
    }
  });

  it("maps duplicate repository errors back to the basics step and name field", () => {
    const plugin = getRepositoryCreatePlugin("apt")!;
    const message = "Repository already exists: debian-internal";

    expect(repositoryCreateStepForServerError(message, plugin)).toBe("basics");
    expect(repositoryCreateFieldErrors(message)).toEqual({
      name: "Repository already exists: debian-internal",
    });
  });

  it("detects duplicate repository names before leaving the basics step", () => {
    expect(repositoryCreateAvailabilityError("debian-internal", ["debian-internal", "python-internal"]))
      .toBe("Repository already exists: debian-internal");
    expect(repositoryCreateAvailabilityError("debian-new", ["debian-internal", "python-internal"]))
      .toBeUndefined();
  });
});
