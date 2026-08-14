import { describe, expect, it } from "vitest";
import {
  hostedRepositoryCreatePlugins,
  repositoryCreateAvailabilityError,
  repositoryCreateFieldErrors,
  repositoryCreateStepForServerError,
} from "./repository-create-plugins";
import {
  getHostedRepositoryCreatePlugin,
  getRepositoryCreatePlugin,
} from "./repository-ui-plugins";

describe("repository create plugins", () => {
  it("exposes APT as a wizard plugin with config and setup steps", () => {
    expect(hostedRepositoryCreatePlugins.map((plugin) => plugin.ecosystem)).toEqual(["apt", "pypi"]);
    expect(getHostedRepositoryCreatePlugin("apt")!).toMatchObject({
      ecosystem: "apt",
      steps: ["plugin", "basics", "config", "setup", "review"],
    });
    expect(getHostedRepositoryCreatePlugin("pypi")!).toMatchObject({
      ecosystem: "pypi",
      steps: ["plugin", "basics", "review"],
    });
  });

  it("derives create steps from repository config field steps", () => {
    expect(getHostedRepositoryCreatePlugin("apt")!.steps).toEqual(["plugin", "basics", "config", "setup", "review"]);
    expect(getHostedRepositoryCreatePlugin("pypi")!.steps).toEqual(["plugin", "basics", "review"]);
  });

  it("exposes repository config fields to the wizard renderer", () => {
    const plugin = getHostedRepositoryCreatePlugin("apt")!;

    expect(plugin.repositoryConfig.namespace).toBe("apt");
    expect(plugin.repositoryConfig.fields.map((field) => [field.name, field.kind, field.step])).toEqual([
      ["codename", "text", "config"],
      ["suites", "string-list", "config"],
      ["signingKey", "signing-key-provisioning", "setup"],
    ]);
  });

  it("builds an APT repository create payload from wizard state", () => {
    const plugin = getHostedRepositoryCreatePlugin("apt")!;

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
      kind: "hosted",
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
    const plugin = getHostedRepositoryCreatePlugin("pypi")!;

    expect(plugin.buildCreateInput({
      name: "python-internal",
      visibility: "private",
      config: {},
      setup: {},
    })).toEqual({
      name: "python-internal",
      ecosystem: "pypi",
      kind: "hosted",
      visibility: "private",
      config: {
        pypi: {},
      },
    });
  });

  it("builds a PyPI proxy repository create payload with an upstream URL mode", () => {
    const plugin = getRepositoryCreatePlugin({ ecosystem: "pypi", kind: "proxy" })!;

    expect(plugin.repositoryConfig.fields.map((field) => [field.name, field.kind, field.step, field.required]))
      .toEqual([
        ["upstreamUrl", "text", "config", true],
        ["upstreamUrlMode", "select", "config", true],
      ]);
    expect(plugin.repositoryConfig.fields[0]).toMatchObject({
      placeholder: "https://pypi.org/",
    });
    expect(plugin.repositoryConfig.fields[1]).toMatchObject({
      defaultValue: "base-url",
      options: [
        { value: "base-url", label: "Base URL" },
        { value: "simple-api-root", label: "Simple API root" },
      ],
    });
    expect(plugin.defaults.config).toEqual({ upstreamUrl: "", upstreamUrlMode: "base-url" });
    expect(plugin.steps).toEqual(["plugin", "basics", "config", "review"]);
    expect(plugin.validateStep("config", {
      name: "python-proxy",
      visibility: "private",
      config: { upstreamUrl: "", upstreamUrlMode: "base-url" },
      setup: {},
    })).toEqual(["Upstream URL is required"]);
    expect(plugin.validateStep("config", {
      name: "python-proxy",
      visibility: "private",
      config: { upstreamUrl: "https://pypi.org/", upstreamUrlMode: "heuristic" },
      setup: {},
    })).toEqual(["Upstream URL mode is required"]);
    expect(plugin.buildCreateInput({
      name: "python-proxy",
      visibility: "public",
      config: { upstreamUrl: " pypi.org/simple ", upstreamUrlMode: "base-url" },
      setup: {},
    })).toEqual({
      name: "python-proxy",
      ecosystem: "pypi",
      kind: "proxy",
      visibility: "public",
      config: {
        pypi: {
          upstreamUrl: "https://pypi.org/simple/",
          upstreamUrlMode: "base-url",
        },
      },
    });
  });

  it("builds an APT proxy repository create payload with upstream and codename", () => {
    const plugin = getRepositoryCreatePlugin({ ecosystem: "apt", kind: "proxy" })!;

    expect(plugin.repositoryConfig.fields.map((field) => [field.name, field.kind, field.step, field.required]))
      .toEqual([
        ["upstreamUrl", "text", "config", true],
        ["codename", "text", "config", true],
        ["components", "string-list", "config", false],
        ["architectures", "string-list", "config", false],
        ["signingPolicy", "signing-key-provisioning", "setup", true],
      ]);
    expect(plugin.repositoryConfig.fields[0]).toMatchObject({
      placeholder: "https://deb.debian.org/debian/",
    });
    expect(plugin.defaults.config).toEqual({
      upstreamUrl: "",
      codename: "",
      components: "",
      architectures: "",
    });
    expect(plugin.defaults.setup).toMatchObject({
      signingMode: "upstream",
      upstreamKeyUrl: "",
      signingKeyMode: "generate",
    });
    expect(plugin.steps).toEqual(["plugin", "basics", "config", "setup", "review"]);
    expect(plugin.validateStep("config", {
      name: "debian-proxy",
      visibility: "private",
      config: { upstreamUrl: "", codename: "bookworm", components: "", architectures: "" },
      setup: {},
    })).toEqual(["Upstream URL is required"]);
    expect(plugin.validateStep("config", {
      name: "debian-proxy",
      visibility: "private",
      config: { upstreamUrl: "deb.example/debian", codename: "", components: "", architectures: "" },
      setup: {},
    })).toEqual(["Codename is required"]);
    expect(plugin.buildCreateInput({
      name: "debian-proxy",
      visibility: "public",
      config: {
        upstreamUrl: " deb.example/debian ",
        codename: "bookworm",
        components: "main contrib",
        architectures: "amd64 arm64",
      },
      setup: {
        signingMode: "upstream",
        upstreamKeyUrl: " download.example/key.gpg ",
      },
    })).toEqual({
      name: "debian-proxy",
      ecosystem: "apt",
      kind: "proxy",
      visibility: "public",
      config: {
        apt: {
          upstreamUrl: "https://deb.example/debian/",
          signing: {
            mode: "upstream",
            upstreamKeyUrl: "https://download.example/key.gpg",
          },
          codename: "bookworm",
          components: ["main", "contrib"],
          architectures: ["amd64", "arm64"],
        },
      },
    });
  });

  it("builds APT proxy signing policy payloads", () => {
    const plugin = getRepositoryCreatePlugin({ ecosystem: "apt", kind: "proxy" })!;
    const baseState = {
      name: "debian-proxy",
      visibility: "private" as const,
      config: {
        upstreamUrl: "deb.example/debian",
        codename: "bookworm",
        components: "",
        architectures: "",
      },
    };

    expect(plugin.buildCreateInput({
      ...baseState,
      setup: { signingMode: "unsigned" },
    })).toMatchObject({
      config: {
        apt: {
          signing: { mode: "unsigned" },
        },
      },
    });

    expect(plugin.buildCreateInput({
      ...baseState,
      setup: {
        signingMode: "axis",
        signingKeyMode: "existing",
        signingKeyExistingId: "signing_key_prod",
      },
    })).toMatchObject({
      config: {
        apt: {
          signing: { mode: "axis" },
        },
      },
      provisioning: {
        apt: {
          signingKey: {
            mode: "existing",
            signingKeyId: "signing_key_prod",
          },
        },
      },
    });
  });

  it("builds an unsigned APT hosted repository create payload", () => {
    const plugin = getHostedRepositoryCreatePlugin("apt")!;

    expect(plugin.buildCreateInput({
      name: "debian-unsigned",
      visibility: "public",
      config: {
        codename: "noble",
      },
      setup: {
        signingMode: "unsigned",
      },
    })).toEqual({
      name: "debian-unsigned",
      ecosystem: "apt",
      kind: "hosted",
      visibility: "public",
      config: {
        apt: {
          codename: "noble",
          signing: { mode: "unsigned" },
        },
      },
    });
  });

  it("builds a PyPI group repository create payload with ordered members", () => {
    const plugin = getRepositoryCreatePlugin({ ecosystem: "pypi", kind: "group" })!;

    expect(plugin.repositoryConfig.fields.map((field) => [field.name, field.kind, field.step, field.required]))
      .toEqual([
        ["members", "pypi-member-select", "config", true],
      ]);
    expect(plugin.defaults.config).toEqual({ members: "" });
    expect(plugin.steps).toEqual(["plugin", "basics", "config", "review"]);
    expect(plugin.validateStep("config", {
      name: "python-group",
      visibility: "private",
      config: { members: "" },
      setup: {},
    })).toEqual(["At least one member repository is required"]);
    expect(plugin.buildCreateInput({
      name: "python-group",
      visibility: "public",
      config: { members: " python-hosted,\npython-proxy,python-hosted " },
      setup: {},
    })).toEqual({
      name: "python-group",
      ecosystem: "pypi",
      kind: "group",
      visibility: "public",
      config: {
        pypi: {
          members: ["python-hosted", "python-proxy"],
        },
      },
    });
  });

  it("maps every server-side repository name rejection back to the basics step", () => {
    const plugin = getHostedRepositoryCreatePlugin("apt")!;

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
    const plugin = getHostedRepositoryCreatePlugin("apt")!;
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
