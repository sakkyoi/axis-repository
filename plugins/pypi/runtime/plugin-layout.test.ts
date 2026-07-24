import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runtimeDir = dirname(fileURLToPath(import.meta.url));

describe("PyPI runtime plugin layout", () => {
  it("keeps runtime plugin responsibilities split into focused files", () => {
    for (const file of ["config.ts", "client-helpers.ts", "runtime.ts"]) {
      expect(existsSync(join(runtimeDir, file)), `plugins/pypi/runtime/${file} must exist`).toBe(true);
    }
  });
});
