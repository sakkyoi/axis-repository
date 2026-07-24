import { describe, expect, it } from "vitest";
import { MemoryStateStore, PluginPolicyService } from "../index";

describe("PluginPolicyService", () => {
  it("returns null when a repository plugin has no persisted policy", async () => {
    const service = new PluginPolicyService({ state: new MemoryStateStore() });

    await expect(service.get("apt")).resolves.toBeNull();
    await expect(service.list()).resolves.toEqual([]);
  });

  it("persists enabled overrides by ecosystem", async () => {
    const service = new PluginPolicyService({ state: new MemoryStateStore() });

    const record = await service.setEnabledOverride("apt", false);

    expect(record).toEqual({ ecosystem: "apt", enabledOverride: false });
    await expect(service.get("apt")).resolves.toEqual(record);
    await expect(service.list()).resolves.toEqual([record]);
  });

  it("resets plugin policy back to the catalog default", async () => {
    const service = new PluginPolicyService({ state: new MemoryStateStore() });

    await service.setEnabledOverride("apt", false);
    const record = await service.setEnabledOverride("apt", null);

    expect(record).toEqual({ ecosystem: "apt", enabledOverride: null });
    await expect(service.get("apt")).resolves.toEqual(record);
  });
});
