import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

describe("runtime plugin layout", () => {
  it("keeps APT domain implementation under the APT plugin directory", () => {
    expect(existsSync(join(srcDir, "apt-client.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "apt-metadata.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "apt-publisher.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "plugins", "apt", "client.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "plugins", "apt", "metadata.ts"))).toBe(true);
    expect(existsSync(join(srcDir, "plugins", "apt", "publisher.ts"))).toBe(true);
  });
});
