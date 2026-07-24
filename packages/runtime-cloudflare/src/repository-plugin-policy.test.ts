import { describe, expect, it } from "vitest";
import { MemoryStateStore, PluginPolicyService, ValidationError } from "@axis-repository/core";
import {
  ensureRepositoryPluginEnabled,
  repositoryPluginPolicyFields,
} from "./repository-plugin-policy";

describe("repository plugin policy", () => {
  it("uses the catalog default when no admin override is stored", async () => {
    const pluginPolicyService = new PluginPolicyService({ state: new MemoryStateStore() });

    await expect(repositoryPluginPolicyFields({
      pluginPolicyService,
      ecosystem: "disabled-demo",
      catalogEnabled: false,
    })).resolves.toEqual({
      catalogEnabled: false,
      enabledOverride: null,
      enabled: false,
    });
  });

  it("lets admin overrides enable or disable the catalog default", async () => {
    const pluginPolicyService = new PluginPolicyService({ state: new MemoryStateStore() });

    await pluginPolicyService.setEnabledOverride("disabled-demo", true);

    await expect(repositoryPluginPolicyFields({
      pluginPolicyService,
      ecosystem: "disabled-demo",
      catalogEnabled: false,
    })).resolves.toEqual({
      catalogEnabled: false,
      enabledOverride: true,
      enabled: true,
    });

    await pluginPolicyService.setEnabledOverride("apt", false);

    await expect(repositoryPluginPolicyFields({
      pluginPolicyService,
      ecosystem: "apt",
      catalogEnabled: true,
    })).resolves.toMatchObject({
      enabled: false,
      enabledOverride: false,
    });
  });

  it("throws the supplied error when the effective policy is disabled", async () => {
    const pluginPolicyService = new PluginPolicyService({ state: new MemoryStateStore() });

    await expect(ensureRepositoryPluginEnabled({
      pluginPolicyService,
      ecosystem: "disabled-demo",
      catalogEnabled: false,
      errorFactory: () => new ValidationError("blocked"),
    })).rejects.toThrow("blocked");
  });
});
