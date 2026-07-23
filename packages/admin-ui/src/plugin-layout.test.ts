import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(srcDir, "..", "..", "..");

describe("admin UI plugin layout", () => {
  it("keeps APT form implementation under the APT UI plugin directory", () => {
    expect(existsSync(join(srcDir, "repository-forms.ts"))).toBe(false);
    expect(existsSync(join(srcDir, "repository-forms.test.ts"))).toBe(false);
    expect(existsSync(join(repoRoot, "plugins", "apt", "admin-ui", "forms.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "apt", "admin-ui", "forms.test.ts"))).toBe(true);
  });

  it("keeps plugin client helper response schemas under UI plugin directories", () => {
    const sharedSchemas = readFileSync(join(srcDir, "api", "schemas.ts"), "utf8");

    expect(sharedSchemas).not.toContain("aptSourceInfoSchema");
    expect(sharedSchemas).not.toContain("pypiClientInfoSchema");
    expect(sharedSchemas).not.toContain("installInstructionsSchema");
    expect(existsSync(join(repoRoot, "plugins", "apt", "admin-ui", "schemas.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "pypi", "admin-ui", "schemas.ts"))).toBe(true);
  });

  it("keeps ecosystem-specific publish models under UI plugin directories", () => {
    const sharedPublishModel = readFileSync(join(srcDir, "admin-publish-form-model.ts"), "utf8");

    expect(sharedPublishModel).not.toContain("AptPublishFormValues");
    expect(sharedPublishModel).not.toContain("defaultAptPublishFormValues");
    expect(sharedPublishModel).not.toContain("buildAptPublishArtifact");
    expect(existsSync(join(repoRoot, "plugins", "apt", "admin-ui", "publish-model.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "apt", "admin-ui", "publish-model.test.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "pypi", "admin-ui", "publish.tsx"))).toBe(true);
  });

  it("keeps concrete admin UI plugin implementations in repo-level plugin directories", () => {
    expect(existsSync(join(srcDir, "plugins", "apt"))).toBe(false);
    expect(existsSync(join(srcDir, "plugins", "pypi"))).toBe(false);
    expect(existsSync(join(repoRoot, "plugins", "apt", "admin-ui", "index.ts"))).toBe(true);
    expect(existsSync(join(repoRoot, "plugins", "pypi", "admin-ui", "index.ts"))).toBe(true);
  });

  it("keeps app consumers behind UI plugin capability accessors", () => {
    const consumerFiles = [
      join(srcDir, "pages", "NewRepositoryPage.tsx"),
      join(srcDir, "pages", "RepositoriesPage.tsx"),
      join(srcDir, "pages", "TokensPage.tsx"),
      join(srcDir, "repository-create-plugins.ts"),
      join(srcDir, "repository-detail-plugins.tsx"),
    ];

    for (const file of consumerFiles) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toContain("getRepositoryUiPlugin");
      expect(content).not.toContain("repositoryUiPlugins");
    }
  });
});
