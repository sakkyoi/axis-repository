import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

describe("admin UI plugin layout", () => {
  it("keeps APT form implementation under the APT UI plugin directory", () => {
    expect(existsSync(join(srcDir, "repository-forms.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "repository-forms.test.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "plugins", "apt", "forms.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "plugins", "apt", "forms.test.ts"))).toBe(true);
  });

  it("keeps plugin client helper response schemas under UI plugin directories", () => {
    const sharedSchemas = readFileSync(join(srcDir, "api", "schemas.ts"), "utf8");

    expect(sharedSchemas).not.toContain("aptSourceInfoSchema");
    expect(sharedSchemas).not.toContain("pypiClientInfoSchema");
    expect(sharedSchemas).not.toContain("installInstructionsSchema");
    expect(existsSync(join(srcDir, "plugins", "apt", "schemas.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "plugins", "pypi", "schemas.ts"))).toBe(true);
  });
});
