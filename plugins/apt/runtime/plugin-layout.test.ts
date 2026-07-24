import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeDir = dirname(fileURLToPath(import.meta.url));

describe("APT runtime plugin layout", () => {
  it("keeps metadata generation split by responsibility", () => {
    for (const file of ["config.ts", "packages.ts", "release.ts", "metadata.ts"]) {
      expect(existsSync(join(runtimeDir, file)), `plugins/apt/runtime/${file} must exist`).toBe(true);
    }
  });

  it("keeps runtime plugin wiring split from client helper and admin resource handlers", () => {
    for (const file of ["client-helpers.ts", "admin-resources.ts", "runtime.ts"]) {
      expect(existsSync(join(runtimeDir, file)), `plugins/apt/runtime/${file} must exist`).toBe(true);
    }
  });
});
