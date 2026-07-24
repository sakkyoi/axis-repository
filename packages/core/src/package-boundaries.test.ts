import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
  const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*\s+from\s+)?["'](@axis-repository\/[^"']+)["']/g;
  const allowedImports = new Set([
    "@axis-repository/admin-ui/plugin-ui",
    "@axis-repository/core",
    "@axis-repository/core/plugin-manifests",
    "@axis-repository/runtime-cloudflare/plugin-runtime",
    "@axis-repository/runtime-cloudflare/plugin-runtime/testing",
  ]);

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    expect(allowedImports, `${filePath} imports non-public package entrypoint ${specifier}`).toContain(specifier);
  }
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

  test("plugins use package public entrypoints instead of package source paths", () => {
    for (const filePath of listSourceFiles("plugins")) {
      const source = readFileSync(path.join(rootDir, filePath), "utf8");

      expect(source, `${filePath} must not deep import package source files`).not.toMatch(
        /packages\/(?:admin-ui|runtime-cloudflare|core|publish-client)\/src/,
      );
      assertOnlyUsesExportedPackageSubpaths(filePath, source);
    }
  });
});
