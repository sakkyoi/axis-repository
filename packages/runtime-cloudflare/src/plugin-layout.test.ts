import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(srcDir, "..", "..", "..");

describe("runtime plugin layout", () => {
  it("keeps APT domain implementation under the APT plugin directory", () => {
    expect(existsSync(join(srcDir, "apt-client.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "apt-metadata.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "apt-publisher.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "plugins", "apt", "runtime", "client.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "apt", "runtime", "metadata.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "apt", "runtime", "publisher.ts"))).toBe(true);
  });

  it("keeps concrete runtime plugin implementations in repo-level plugin directories", () => {
    expect(existsSync(join(srcDir, "plugins", "apt"))).toBe(false);
    expect(existsSync(join(srcDir, "plugins", "pypi"))).toBe(false);
    expect(existsSync(join(repoRoot, "plugins", "apt", "runtime", "runtime.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "apt", "runtime", "publisher.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "pypi", "runtime", "runtime.ts"))).toBe(true);
  });
});
