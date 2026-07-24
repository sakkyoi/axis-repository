import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

type PackageJson = {
  name: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
};

const packageDirs = {
  core: "packages/core",
  adminUi: "packages/admin-ui",
  runtimeCloudflare: "packages/runtime-cloudflare",
  publishClient: "packages/publish-client",
} as const;

const expectedExports: Record<keyof typeof packageDirs, string[]> = {
  core: [".", "./plugin-manifests"],
  adminUi: ["./plugin-ui"],
  runtimeCloudflare: [".", "./plugin-runtime", "./plugin-runtime/testing"],
  publishClient: [".", "./cli"],
};

const forbiddenWorkspaceDependencies: Record<keyof typeof packageDirs, string[]> = {
  core: ["@axis-repository/admin-ui", "@axis-repository/runtime-cloudflare", "@axis-repository/publish-client"],
  adminUi: ["@axis-repository/runtime-cloudflare", "@axis-repository/publish-client"],
  runtimeCloudflare: ["@axis-repository/admin-ui", "@axis-repository/publish-client"],
  publishClient: ["@axis-repository/admin-ui", "@axis-repository/runtime-cloudflare"],
};

const pluginImplementationImportPattern = /(?:^|[\\/])plugins[\\/][^\\/]+[\\/](?:runtime|admin-ui)(?:[\\/]|$)/;
const runtimePluginImplementationImportPattern = /(?:^|[\\/])plugins[\\/][^\\/]+[\\/]runtime(?:[\\/]|$)/;
const adminUiPluginImplementationImportPattern = /(?:^|[\\/])plugins[\\/][^\\/]+[\\/]admin-ui(?:[\\/]|$)/;
const sourceImportPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*\s+from\s+)?["']([^"']+)["']/g;

function readPackageJson(packageDir: string): PackageJson {
  return JSON.parse(readFileSync(path.join(rootDir, packageDir, "package.json"), "utf8")) as PackageJson;
}

function listSourceFiles(dir: string): string[] {
  const absoluteDir = path.join(rootDir, dir);
  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.relative(rootDir, absolutePath);
    if (entry === "node_modules" || entry === "dist" || entry === ".wrangler") {
      return [];
    }
    if (statSync(absolutePath).isDirectory()) {
      return listSourceFiles(relativePath);
    }
    return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry) ? [relativePath] : [];
  });
}

function assertOnlyUsesExportedPackageSubpaths(filePath: string, source: string) {
  const allowedImports = new Set([
    "@axis-repository/admin-ui/plugin-ui",
    "@axis-repository/core",
    "@axis-repository/core/plugin-manifests",
    "@axis-repository/runtime-cloudflare/plugin-runtime",
    "@axis-repository/runtime-cloudflare/plugin-runtime/testing",
  ]);

  for (const match of source.matchAll(sourceImportPattern)) {
    const specifier = match[1];
    if (!specifier?.startsWith("@axis-repository/")) {
      continue;
    }
    expect(allowedImports, `${filePath} imports non-public package entrypoint ${specifier}`).toContain(specifier);
  }
}

function importSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(sourceImportPattern), (match) => match[1]).filter((specifier): specifier is string =>
    Boolean(specifier),
  );
}

describe("package boundaries", () => {
  test("workspace packages expose only explicit public entrypoints", () => {
    for (const [packageKey, packageDir] of Object.entries(packageDirs) as Array<[keyof typeof packageDirs, string]>) {
      const packageJson = readPackageJson(packageDir);

      expect(Object.keys(packageJson.exports ?? {}).sort(), `${packageJson.name} exports`).toEqual(
        expectedExports[packageKey].sort(),
      );
    }
  });

  test("workspace packages do not depend on packages above their layer", () => {
    for (const [packageKey, packageDir] of Object.entries(packageDirs) as Array<[keyof typeof packageDirs, string]>) {
      const packageJson = readPackageJson(packageDir);
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      for (const dependencyName of forbiddenWorkspaceDependencies[packageKey]) {
        expect(dependencies, `${packageJson.name} must not depend on ${dependencyName}`).not.toHaveProperty(
          dependencyName,
        );
      }
    }
  });

  test("runtime build can refresh embedded admin UI assets without a package dependency", () => {
    const rootPackageJson = readPackageJson(".");
    const runtimePackageJson = readPackageJson(packageDirs.runtimeCloudflare);

    expect(runtimePackageJson.scripts?.build, "@axis-repository/runtime-cloudflare standalone build").toContain(
      "pnpm --filter @axis-repository/admin-ui build",
    );
    expect(runtimePackageJson.scripts?.["build:worker"], "@axis-repository/runtime-cloudflare worker build").toContain(
      "generate-admin-ui-assets.mjs",
    );
    expect(rootPackageJson.scripts?.build, "root build should avoid rebuilding admin-ui through runtime build").toContain(
      "pnpm --filter @axis-repository/runtime-cloudflare build:worker",
    );
  });

  test("plugin implementation import detection covers future ecosystems", () => {
    expect(pluginImplementationImportPattern.test("../../../plugins/npm/runtime/runtime")).toBe(true);
    expect(pluginImplementationImportPattern.test("../../../plugins/npm/admin-ui")).toBe(true);
  });

  test("plugin implementation imports stay centralized in registries and tests", () => {
    const packageSourceFiles = Object.values(packageDirs).flatMap((packageDir) => listSourceFiles(`${packageDir}/src`));
    for (const filePath of [...packageSourceFiles, ...listSourceFiles("plugins")]) {
      const normalizedPath = path.normalize(filePath);
      const source = readFileSync(path.join(rootDir, filePath), "utf8");
      if (!pluginImplementationImportPattern.test(source)) {
        continue;
      }

      expect(
        normalizedPath === path.normalize("packages/runtime-cloudflare/src/bundled-runtime-plugins.ts") ||
          normalizedPath === path.normalize("packages/admin-ui/src/repository-ui-plugins.ts") ||
          normalizedPath.endsWith(".test.ts") ||
          normalizedPath.endsWith(".test.tsx"),
        `${filePath} must import plugin implementations through a package host loader or a focused test`,
      ).toBe(true);
    }
  });

  test("host registries load package-owned plugin loaders instead of plugin registry entrypoints", () => {
    const runtimeRegistrySource = readFileSync(
      path.join(rootDir, "packages/runtime-cloudflare/src/default-plugins.ts"),
      "utf8",
    );
    const adminUiRegistrySource = readFileSync(
      path.join(rootDir, "packages/admin-ui/src/repository-ui-plugins.ts"),
      "utf8",
    );

    expect(importSpecifiers(runtimeRegistrySource)).toContain("./bundled-runtime-plugins");
    expect(importSpecifiers(adminUiRegistrySource)).toContain("../../../plugins/bundled");
    expect(importSpecifiers(runtimeRegistrySource)).not.toContain("../../../plugins/runtime");
    expect(importSpecifiers(adminUiRegistrySource)).not.toContain("../../../plugins/admin-ui");
    expect(runtimeRegistrySource).not.toMatch(pluginImplementationImportPattern);
    expect(adminUiRegistrySource).not.toMatch(pluginImplementationImportPattern);
  });

  test("plugin bundles are the shared source for enabled ecosystem metadata", () => {
    for (const catalogPath of ["plugins/catalog.ts", "plugins/bundled.ts"]) {
      expect(existsSync(path.join(rootDir, catalogPath)), `${catalogPath} must exist`).toBe(true);
    }
    expect(existsSync(path.join(rootDir, "plugins/runtime.ts")), "runtime registration belongs in the host loader").toBe(false);
    expect(existsSync(path.join(rootDir, "plugins/admin-ui.ts")), "admin UI registration belongs in the host loader").toBe(false);

    const catalogSource = readFileSync(path.join(rootDir, "plugins/catalog.ts"), "utf8");
    const bundledPluginsSource = readFileSync(path.join(rootDir, "plugins/bundled.ts"), "utf8");
    expect(catalogSource).toContain("repositoryPluginCatalog");
    expect(catalogSource).toContain("enabled");
    expect(catalogSource).toContain("experimental");
    expect(catalogSource).toContain("runtime");
    expect(catalogSource).toContain("adminUi");
    expect(catalogSource).not.toMatch(pluginImplementationImportPattern);
    expect(bundledPluginsSource).toContain("bundledRepositoryPlugins");
    expect(bundledPluginsSource).toContain("aptRepositoryPluginBundle");
    expect(bundledPluginsSource).toContain("pypiRepositoryPluginBundle");
  });

  test("plugin bundles declare capabilities without importing host-specific implementations", () => {
    const bundleSources = [
      readFileSync(path.join(rootDir, "plugins/apt/plugin.ts"), "utf8"),
      readFileSync(path.join(rootDir, "plugins/pypi/plugin.ts"), "utf8"),
    ];

    for (const source of bundleSources) {
      expect(source).toContain("satisfies RepositoryPluginBundle");
      expect(source).toContain("runtime: true");
      expect(source).toContain("adminUi: true");
      expect(source).not.toMatch(pluginImplementationImportPattern);
    }
  });

  test("package host loaders own runtime and admin UI implementation wiring", () => {
    const runtimeLoaderSource = readFileSync(
      path.join(rootDir, "packages/runtime-cloudflare/src/bundled-runtime-plugins.ts"),
      "utf8",
    );
    const adminUiRegistrySource = readFileSync(
      path.join(rootDir, "packages/admin-ui/src/repository-ui-plugins.ts"),
      "utf8",
    );
    const runtimeImports = importSpecifiers(runtimeLoaderSource);
    const adminUiImports = importSpecifiers(adminUiRegistrySource);

    expect(runtimeImports).toContain("../../../plugins/bundled");
    expect(runtimeImports.some((specifier) => /^..\/..\/..\/plugins\/[^/]+\/runtime(?:\/|$)/.test(specifier))).toBe(true);
    expect(runtimeImports.some((specifier) => /^..\/..\/..\/plugins\/[^/]+\/admin-ui(?:\/|$)/.test(specifier))).toBe(false);
    expect(adminUiImports).toContain("../../../plugins/bundled");
    expect(adminUiImports.some((specifier) => /^..\/..\/..\/plugins\/[^/]+\/admin-ui(?:\/|$)/.test(specifier))).toBe(true);
    expect(adminUiImports.some((specifier) => /^..\/..\/..\/plugins\/[^/]+\/runtime(?:\/|$)/.test(specifier))).toBe(false);
  });

  test("plugin authoring guide documents the enforced contract", () => {
    const guidePath = path.join(rootDir, "docs/plugin-authoring.md");

    expect(existsSync(guidePath), "docs/plugin-authoring.md must describe the plugin contract").toBe(true);

    const guide = readFileSync(guidePath, "utf8");
    expect(guide).toContain("@axis-repository/core/plugin-manifests");
    expect(guide).toContain("@axis-repository/runtime-cloudflare/plugin-runtime");
    expect(guide).toContain("@axis-repository/admin-ui/plugin-ui");
    expect(guide).toContain("plugins/catalog.ts");
    expect(guide).toContain("plugins/bundled.ts");
    expect(guide).toContain("RepositoryPluginBundle");
    expect(guide).toContain("pnpm test");
  });

  test("plugins use package public entrypoints instead of package source paths", () => {
    for (const filePath of listSourceFiles("plugins")) {
      const source = readFileSync(path.join(rootDir, filePath), "utf8");

      expect(source, `${filePath} must not deep import package source files`).not.toMatch(
        /packages\/(?:admin-ui|runtime-cloudflare|core|publish-client)\/src/,
      );
      assertOnlyUsesExportedPackageSubpaths(filePath, source);
    }
  });

  test("runtime signing key behavior stays owned by repository plugins", () => {
    expect(
      existsSync(path.join(rootDir, "packages/runtime-cloudflare/src/signing-key-service.ts")),
      "host runtime must not expose an APT-specific signing key service",
    ).toBe(false);
  });

  test("runtime plugin contracts stay split from the registry implementation", () => {
    const runtimeSourceDir = path.join(rootDir, "packages/runtime-cloudflare/src");
    for (const contractFile of [
      "repository-plugin-contract.ts",
      "repository-plugin-client-helpers.ts",
      "repository-plugin-admin-resources.ts",
      "repository-plugin-capabilities.ts",
    ]) {
      expect(existsSync(path.join(runtimeSourceDir, contractFile)), `${contractFile} must exist`).toBe(true);
    }

    const registrySource = readFileSync(
      path.join(runtimeSourceDir, "repository-runtime-plugin-registry.ts"),
      "utf8",
    );
    expect(registrySource).not.toContain("export interface RepositorySecretCapability");
    expect(registrySource).not.toContain("export interface RepositoryClientHelperInput");
    expect(registrySource).not.toContain("export interface RepositoryAdminResourceInput");
    expect(registrySource).not.toContain("export async function dispatchRepositoryClientHelper");
    expect(registrySource).not.toContain("export async function dispatchRepositoryAdminResource");
  });
});
