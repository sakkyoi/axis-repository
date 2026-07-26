import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(srcDir, "..", "..", "..");

describe("admin UI plugin layout", () => {
  it("keeps feature workflow files out of the admin UI src root", () => {
    const allowedRootFiles = new Set([
      "App.tsx",
      "auth.test.ts",
      "auth.tsx",
      "login.test.ts",
      "login.ts",
      "main.tsx",
      "navigation.test.ts",
      "navigation.ts",
      "plugin-layout.test.ts",
      "plugin-ui.ts",
      "runtime-config.test.ts",
      "runtime-config.ts",
      "styles.css",
      "theme.test.ts",
      "theme.tsx",
    ]);
    const rootFiles = readdirSync(srcDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();

    expect(rootFiles.filter((file) => !allowedRootFiles.has(file))).toEqual([]);
    expect(existsSync(join(srcDir, "repositories", "create"))).toBe(true);
    expect(existsSync(join(srcDir, "repositories", "detail"))).toBe(true);
    expect(existsSync(join(srcDir, "repositories", "plugins"))).toBe(true);
    expect(existsSync(join(srcDir, "repositories", "publish"))).toBe(true);
    expect(existsSync(join(srcDir, "tokens"))).toBe(true);
  });

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
    const sharedPublishModel = readFileSync(join(srcDir, "repositories", "publish", "admin-publish-form-model.ts"), "utf8");

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
      join(srcDir, "repositories", "plugins", "repository-create-plugins.ts"),
      join(srcDir, "repositories", "plugins", "repository-detail-plugins.tsx"),
    ];

    for (const file of consumerFiles) {
      const content = readFileSync(file, "utf8");
      expect(content).not.toContain("getRepositoryUiPlugin");
      expect(content).not.toContain("repositoryUiPlugins");
    }
  });

  it("keeps deployment diagnostics out of the primary app header", () => {
    const appLayout = readFileSync(join(srcDir, "components", "AppLayout.tsx"), "utf8");

    expect(appLayout).not.toContain("API target:");
    expect(appLayout).not.toContain("getRuntimeConfig");
  });
});
