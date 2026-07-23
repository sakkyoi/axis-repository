import { existsSync } from "node:fs";
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
});
