import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(
  import.meta.dirname,
  "../../scripts/generate-admin-ui-assets.mjs",
);

describe("generate-admin-ui-assets script", () => {
  it("writes embedded admin UI assets outside tracked runtime source", async () => {
    const source = await readFile(scriptPath, "utf8");

    expect(source).toContain('const outputFile = resolve(packageRoot, "generated/admin-ui-assets.ts");');
    expect(source).not.toContain('src/admin-ui-assets/generated.ts');
  });
});
